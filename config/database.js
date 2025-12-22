// config/database.js
// Enhanced database configuration with connection retry logic and circuit breaker
import { Pool } from "pg";
import dotenv from "dotenv";
import { createComponentLogger } from "../utils/logger.js";

dotenv.config();

const logger = createComponentLogger("DATABASE");

// Database configuration with optimized settings
const dbConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 50, // Increased from 20 to handle more concurrent connections
  min: 5, // Keep minimum connections ready
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased from 5000ms
  acquireTimeoutMillis: 60000,
  createTimeoutMillis: 20000, // Increased from 15000ms
  destroyTimeoutMillis: 5000,
  reapIntervalMillis: 1000,
  createRetryIntervalMillis: 500,
  maxUses: 7500,
  allowExitOnIdle: false, // Changed to false to keep pool alive
  keepAlive: true, // Enable TCP keep-alive
  keepAliveInitialDelayMillis: 10000,
};

// Create connection pool
const pool = new Pool(dbConfig);

// Circuit breaker state
const circuitBreaker = {
  state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
  failureCount: 0,
  failureThreshold: 10, // Open circuit after 10 consecutive failures
  successThreshold: 3, // Close circuit after 3 consecutive successes in HALF_OPEN
  timeout: 30000, // 30 seconds before attempting to close circuit
  nextAttempt: Date.now(),
};

// Connection event handlers with better logging
pool.on("connect", (client) => {
  logger.debug("New database client connected");
});

pool.on("acquire", (client) => {
  // Track connection acquisition for monitoring
});

pool.on("remove", (client) => {
  logger.debug("Database client removed from pool");
});

pool.on("error", (err, client) => {
  logger.error("Database pool error:", {
    message: err.message,
    code: err.code,
    errno: err.errno,
    address: err.address,
    port: err.port
  });
  
  // Increment circuit breaker failure count
  circuitBreaker.failureCount++;
  
  // Open circuit if threshold reached
  if (circuitBreaker.failureCount >= circuitBreaker.failureThreshold) {
    if (circuitBreaker.state !== 'OPEN') {
      circuitBreaker.state = 'OPEN';
      circuitBreaker.nextAttempt = Date.now() + circuitBreaker.timeout;
      logger.error(`Circuit breaker OPENED - too many failures (${circuitBreaker.failureCount})`);
    }
  }
});

// Retry configuration
const RETRY_CONFIG = {
  maxAttempts: 3, // Reduced from 5 to fail faster
  baseDelay: 500, // Reduced from 1000ms
  maxDelay: 10000, // Reduced from 30000ms
  backoffFactor: 2
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
 * Check circuit breaker state
 */
function checkCircuitBreaker() {
  if (circuitBreaker.state === 'OPEN') {
    // Check if it's time to attempt half-open state
    if (Date.now() >= circuitBreaker.nextAttempt) {
      circuitBreaker.state = 'HALF_OPEN';
      circuitBreaker.failureCount = 0;
      logger.info('Circuit breaker entering HALF_OPEN state');
      return true;
    }
    return false; // Circuit still open
  }
  return true; // Circuit closed or half-open
}

/**
 * Reset circuit breaker on successful operation
 */
function resetCircuitBreaker() {
  if (circuitBreaker.state === 'HALF_OPEN') {
    circuitBreaker.failureCount--;
    if (circuitBreaker.failureCount <= -circuitBreaker.successThreshold) {
      circuitBreaker.state = 'CLOSED';
      circuitBreaker.failureCount = 0;
      logger.info('Circuit breaker CLOSED - connection restored');
    }
  } else if (circuitBreaker.state === 'CLOSED') {
    // Reset failure count on success
    circuitBreaker.failureCount = Math.max(0, circuitBreaker.failureCount - 1);
  }
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
      
      // Reset circuit breaker on success
      resetCircuitBreaker();
      
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
    resetCircuitBreaker();
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
      min: dbConfig.min,
      connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
      createTimeoutMillis: dbConfig.createTimeoutMillis
    },
    circuitBreaker: {
      state: circuitBreaker.state,
      failureCount: circuitBreaker.failureCount,
      nextAttempt: circuitBreaker.state === 'OPEN' ? new Date(circuitBreaker.nextAttempt).toISOString() : null
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
 * Execute query with enhanced error handling and circuit breaker
 */
async function query(text, params) {
  // Check circuit breaker
  if (!checkCircuitBreaker()) {
    const error = new Error('Circuit breaker is OPEN - database unavailable');
    error.code = 'CIRCUIT_OPEN';
    throw error;
  }

  const start = Date.now();
  let lastError;
  
  // Simple retry for connection-related errors
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await pool.query(text, params);
      const duration = Date.now() - start;
      
      // Reset circuit breaker on success
      resetCircuitBreaker();
      
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
      const isConnectionError = error.code === 'ECONNREFUSED' || 
                                error.code === 'ECONNRESET' || 
                                error.code === 'ETIMEDOUT' ||
                                error.message?.includes('timeout');
      
      if (attempt === 1 && isConnectionError) {
        logger.warn(`Query attempt ${attempt} failed, retrying:`, error.message);
        circuitBreaker.failureCount++;
        await sleep(100); // Short delay before retry
        continue;
      }
      
      break;
    }
  }
  
  // Log error and update circuit breaker
  circuitBreaker.failureCount++;
  
  logger.error("Database query error:", {
    error: lastError.message,
    code: lastError.code,
    query: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
    params: params,
    circuitState: circuitBreaker.state,
    failureCount: circuitBreaker.failureCount
  });
  
  throw lastError;
}

/**
 * Execute transaction with automatic rollback
 */
async function transaction(callback) {
  // Check circuit breaker
  if (!checkCircuitBreaker()) {
    const error = new Error('Circuit breaker is OPEN - database unavailable');
    error.code = 'CIRCUIT_OPEN';
    throw error;
  }

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    
    // Reset circuit breaker on success
    resetCircuitBreaker();
    
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error("Transaction rollback failed:", rollbackError.message);
    }
    
    circuitBreaker.failureCount++;
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Health check with circuit breaker info
 */
async function healthCheck() {
  try {
    const isHealthy = await testConnectionOnce();
    const stats = getPoolStats();
    
    return {
      healthy: isHealthy && circuitBreaker.state !== 'OPEN',
      circuitState: circuitBreaker.state,
      poolStats: stats,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      healthy: false,
      circuitState: circuitBreaker.state,
      error: error.message,
      timestamp: new Date().toISOString()
    };
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
  transaction,
  healthCheck,
  checkCircuitBreaker,
  circuitBreaker
};

export default pool;