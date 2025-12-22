// database/migrations/run-migrations.js
// Simple migration runner - just executes SQL files
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pool from "../../config/database.js";
import { createComponentLogger } from "../../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logger = createComponentLogger("MIGRATIONS");

/**
 * Run database migrations - simply execute all SQL files in order
 */
async function runMigrations() {
  try {
    logger.info("🔄 Running database migrations...");

    // Test database connection
    await pool.query('SELECT NOW()');
    logger.info("✅ Database connection verified");

    // Get all SQL files in the migrations directory
    const migrationsDir = path.join(__dirname);
    const sqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort(); // Sort to ensure consistent order (001_xxx.sql, 002_xxx.sql, etc.)

    if (sqlFiles.length === 0) {
      logger.warn("⚠️  No SQL migration files found");
      return true;
    }

    logger.info(`Found ${sqlFiles.length} SQL file(s)`);

    // Execute each SQL file
    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf8");
      
      logger.info(`⏳ Executing: ${file}`);
      
      try {
        await pool.query(sql);
        logger.info(`✅ Completed: ${file}`);
      } catch (error) {
        logger.error(`❌ Error in ${file}:`, error.message);
        throw error;
      }
    }

    logger.info("✅ All migrations completed successfully");
    return true;

  } catch (error) {
    logger.error("❌ Migration failed:", error.message);
    throw error;
  }
}

// Export the function
export { runMigrations };

// Run migrations if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      logger.info("✅ Migration process completed");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("❌ Migration process failed:", error);
      process.exit(1);
    });
}