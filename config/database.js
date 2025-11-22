// config/database.js
// Enhanced database configuration with connection retry logic
import { Pool } from "pg";
import dotenv from "dotenv";
import { createComponentLogger } from "../utils/logger.js";

dotenv.config();

const logger = createComponentLogger("DATABASE");

// Database configuration with retry settings
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000, // Increased from 2000ms
  acquireTimeoutMillis: 60000,
  createTimeoutMillis: 15000, // Increased from 8000ms
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 500, // Increased retry interval
  maxUses: 7500, // Maximum uses before connection refresh
  allowExitOnIdle: true // Allow pool to exit when idle
};

// Create connection pool
const pool = new Pool(dbConfig);

// Connection event handlers with better logging
pool.on("connect", (client) => {
  //logger.debug("New database client connected");
});

pool.on("error", (err, client) => {
  logger.error("Database pool error:", {
    message: err.message,
    code: err.code,
    errno: err.errno,
    address: err.address,
    port: err.port
  });
});

// Retry configuration
const RETRY_CONFIG = {
  maxAttempts: 5,
  baseDelay: 1000, // Start with 1 second
  maxDelay: 30000, // Cap at 30 seconds
  backoffFactor: 2 // Exponential backoff
};

/**
 * Sleep utility for retry delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Calculate delay for retry attempt
 */
function calculateDelay(attempt, baseDelay, maxDelay, backoffFactor) {
  const delay = baseDelay * Math.pow(backoffFactor, attempt - 1);
  return Math.min(delay, maxDelay);
}

/**
 * Test database connection with retry logic
 */
async function testConnection() {
  let lastError;
  
  for (let attempt = 1; attempt <= RETRY_CONFIG.maxAttempts; attempt++) {
    try {
      logger.info(`Database connection attempt ${attempt}/${RETRY_CONFIG.maxAttempts}`);
      
      const client = await pool.connect();
      const result = await client.query('SELECT NOW() as current_time, version() as version');
      client.release();
      
      logger.info("Database connection test successful", {
        attempt,
        timestamp: result.rows[0].current_time,
        version: result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]
      });
      
      return true;
    } catch (error) {
      lastError = error;
      logger.warn(`Database connection attempt ${attempt} failed:`, {
        message: error.message,
        code: error.code,
        errno: error.errno,
        address: error.address,
        port: error.port
      });
      
      if (attempt < RETRY_CONFIG.maxAttempts) {
        const delay = calculateDelay(attempt, RETRY_CONFIG.baseDelay, RETRY_CONFIG.maxDelay, RETRY_CONFIG.backoffFactor);
        logger.info(`Retrying in ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  
  logger.error("All database connection attempts failed:", lastError);
  return false;
}

/**
 * Test a single connection without retry (for health checks)
 */
async function testConnectionOnce() {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    logger.debug("Single connection test failed:", error.message);
    return false;
  }
}

/**
 * Get detailed pool statistics
 */
function getPoolStats() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    config: {
      max: dbConfig.max,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
      createTimeoutMillis: dbConfig.createTimeoutMillis
    }
  };
}

/**
 * Gracefully close all connections with retry
 */
async function closePool() {
  let attempts = 3;
  while (attempts > 0) {
    try {
      await pool.end();
      logger.info("Database connection pool closed successfully");
      return;
    } catch (error) {
      attempts--;
      logger.warn(`Error closing database pool (${attempts} attempts remaining):`, error.message);
      if (attempts > 0) {
        await sleep(1000);
      }
    }
  }
  logger.error("Failed to close database pool after all attempts");
}

/**
 * Execute query with enhanced error handling
 */
async function query(text, params) {
  const start = Date.now();
  let lastError;
  
  // Simple retry for connection-related errors
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      
      if (duration > 1000) {
        logger.warn("Slow query detected", {
          duration: `${duration}ms`,
          query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          attempt
        });
      }
      
      return result;
    } catch (error) {
      lastError = error;
      
      // Only retry on connection errors
      if (attempt === 1 && (error.code === 'ECONNREFUSED' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
        logger.warn(`Query attempt ${attempt} failed, retrying:`, error.message);
        await sleep(100); // Short delay before retry
        continue;
      }
      
      break;
    }
  }
  
  logger.error("Database query error:", {
    error: lastError.message,
    code: lastError.code,
    query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
    params: params
  });
  throw lastError;
}

/**
 * Execute transaction with automatic rollback
 */
async function transaction(callback) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error("Transaction rollback failed:", rollbackError.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

// Export pool and utility functions
export { 
  pool,
  testConnection,
  testConnectionOnce,
  getPoolStats,
  closePool,
  query,
  transaction
};

export default pool;