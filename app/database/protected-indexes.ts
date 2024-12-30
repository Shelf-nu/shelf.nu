/**
 * Configuration and utilities for protecting specific PostgreSQL indexes from being dropped during Prisma migrations.
 * This is necessary because Prisma attempts to drop certain many-to-many relationship indexes that we want to maintain.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Indexes that should be protected from being dropped during migrations.
 * These are crucial for performance in many-to-many relationship queries.
 *
 * _AssetToBooking_Asset_idx: Optimizes booking availability checks
 * _AssetToTag_asset_idx: Optimizes tag filtering operations
 */
const PROTECTED_INDEXES = [
  "_AssetToBooking_Asset_idx", // Critical for booking availability checks
  "_AssetToTag_asset_idx", // Critical for tag filtering performance
] as const;

/**
 * Processes a newly created migration file to remove any DROP INDEX statements
 * for protected indexes. This ensures our critical indexes remain in place.
 *
 * @throws {Error} If the migrations directory cannot be read or if migration files cannot be processed
 */
export function protectIndexesInMigration(): void {
  try {
    // Get the directory path using ESM compatible approach
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    const migrationsDir = path.join(currentDir, "migrations");

    const migrations = fs
      .readdirSync(migrationsDir)
      .filter((file) =>
        fs.statSync(path.join(migrationsDir, file)).isDirectory()
      )
      .sort((a, b) => b.localeCompare(a)); // Get latest migration first

    const latestMigration = migrations[0];
    if (!latestMigration) {
      console.log("No migrations found to process");
      return;
    }

    const migrationPath = path.join(
      migrationsDir,
      latestMigration,
      "migration.sql"
    );
    if (!fs.existsSync(migrationPath)) {
      console.log(`No migration file found in ${latestMigration}`);
      return;
    }

    let content = fs.readFileSync(migrationPath, "utf8");
    let modified = false;

    PROTECTED_INDEXES.forEach((index) => {
      const dropIndexPattern = new RegExp(
        `-- DropIndex\\s*DROP INDEX (?:IF EXISTS )?["']?${index}["']?;\\s*`,
        "gi"
      );

      if (dropIndexPattern.test(content)) {
        content = content.replace(dropIndexPattern, "");
        modified = true;
        console.log(`Protected index ${index} from being dropped`);
      }
    });

    if (modified) {
      fs.writeFileSync(migrationPath, content);
      console.log(`Successfully processed migration ${latestMigration}`);
    } else {
      console.log("No protected indexes were found in drop statements");
    }
  } catch (error) {
    console.error("Failed to process migration for protected indexes:", error);
    throw error;
  }
}
