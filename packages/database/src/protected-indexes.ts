/* eslint-disable no-console */
/**
 * Protects database objects that `schema.prisma` does not describe from being
 * dropped by a generated migration.
 *
 * `prisma migrate dev` diffs the schema against the database. An index or a
 * foreign key that exists only in hand-written migration SQL looks like drift
 * to it, so a generated migration drops it. `db:prepare-migration` runs
 * `post-migration.ts` right after generating, which strips those drops from
 * the newest migration before anyone commits it.
 *
 * Add an object here whenever a migration creates one that the schema cannot
 * describe. `protected-indexes.test.ts` fails when a migration creates a
 * foreign key that is neither in the schema nor in this list.
 *
 * @see {@link file://./post-migration.ts}
 * @see {@link file://./../../../apps/docs/protected-indexes.md}
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Indexes created by hand-written migrations, kept for query performance.
 *
 * _AssetToTag_asset_idx: Optimizes tag filtering operations
 */
export const PROTECTED_INDEXES = [
  "_AssetToTag_asset_idx", // Critical for tag filtering performance
] as const;

/**
 * Foreign keys on plain columns that deliberately have no Prisma `@relation`.
 *
 * Each column is declared without a relation because adding one pushes the
 * extended client's generics past TypeScript's instantiation limit (TS2321).
 * The migration that adds the column creates the FK by hand, so the database
 * keeps its `ON DELETE` behaviour while Prisma does not know the FK exists.
 */
export const PROTECTED_FOREIGN_KEYS = [
  // Deleting a custom field removes the asset model defaults for it (CASCADE).
  "AssetModelCustomFieldDefault_customFieldId_fkey",
  // Booking slice provenance; each is SET NULL when its target is deleted.
  "BookingAsset_assetKitId_fkey",
  "BookingAsset_bookingModelRequestId_fkey",
  "BookingAsset_sourceKitId_fkey",
  "BookingAsset_sourceLocationId_fkey",
  // Which booking slice a consumption log row is attributed to (SET NULL).
  "ConsumptionLog_bookingAssetId_fkey",
] as const;

/** Escapes a database object name for use inside a regular expression. */
function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Removes the statements that would drop a protected index or foreign key
 * from migration SQL, together with the `-- DropIndex` / `-- DropForeignKey`
 * comment Prisma writes above each one. Every other statement is kept.
 *
 * @param sql - The SQL of a generated migration
 * @returns The SQL without protected drops, and the names it kept from being dropped
 */
export function stripProtectedDrops(sql: string): {
  sql: string;
  protectedNames: string[];
} {
  let content = sql;
  const protectedNames: string[] = [];

  for (const index of PROTECTED_INDEXES) {
    // Prisma writes the index schema-qualified (`"public"."<name>"`).
    const pattern = new RegExp(
      `(?:-- DropIndex\\s*)?DROP INDEX\\s+(?:IF EXISTS\\s+)?(?:"[^"]+"\\.)?["']?${escapeRegExp(
        index
      )}["']?;[^\\S\\n]*\\n?`,
      "gi"
    );
    if (pattern.test(content)) {
      content = content.replace(pattern, "");
      protectedNames.push(index);
    }
  }

  for (const foreignKey of PROTECTED_FOREIGN_KEYS) {
    // Prisma writes the table schema-qualified (`"public"."<Table>"`).
    const pattern = new RegExp(
      `(?:-- DropForeignKey\\s*)?ALTER TABLE\\s+(?:"[^"]+"\\.)?"[^"]+"\\s+DROP CONSTRAINT\\s+(?:IF EXISTS\\s+)?"${escapeRegExp(
        foreignKey
      )}";[^\\S\\n]*\\n?`,
      "gi"
    );
    if (pattern.test(content)) {
      content = content.replace(pattern, "");
      protectedNames.push(foreignKey);
    }
  }

  return { sql: content, protectedNames };
}

/**
 * Removes drops of protected indexes and foreign keys from the newest
 * migration file, in place.
 *
 * @throws {Error} If the migrations directory cannot be read or if migration files cannot be processed
 */
export function protectIndexesInMigration(): void {
  try {
    // Get the directory path using ESM compatible approach
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    const migrationsDir = path.join(currentDir, "..", "prisma", "migrations");

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

    const { sql, protectedNames } = stripProtectedDrops(
      fs.readFileSync(migrationPath, "utf8")
    );

    if (protectedNames.length > 0) {
      fs.writeFileSync(migrationPath, sql);
      for (const name of protectedNames) {
        console.log(`Protected ${name} from being dropped`);
      }
      console.log(`Successfully processed migration ${latestMigration}`);
    } else {
      console.log("No protected indexes or foreign keys were dropped");
    }
  } catch (error) {
    console.error(
      "Failed to process migration for protected indexes and foreign keys:",
      error
    );
    throw error;
  }
}
