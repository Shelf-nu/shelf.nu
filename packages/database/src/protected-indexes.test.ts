/**
 * Tests for the protection that keeps generated migrations from dropping
 * indexes and foreign keys that `schema.prisma` does not describe.
 *
 * Run with `pnpm --filter @shelf/database test`. Nothing here touches a
 * database: the stripping tests use sample SQL, and the guard reads the
 * committed migrations and schema from disk.
 *
 * @see ./protected-indexes.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  PROTECTED_FOREIGN_KEYS,
  PROTECTED_INDEXES,
  stripProtectedDrops,
} from "./protected-indexes";

const prismaDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "prisma"
);

test("strips a generated drop of a protected foreign key and keeps the rest", () => {
  const sql = [
    "-- DropForeignKey",
    'ALTER TABLE "BookingAsset" DROP CONSTRAINT "BookingAsset_assetKitId_fkey";',
    "",
    "-- DropForeignKey",
    'ALTER TABLE "Note" DROP CONSTRAINT "Note_userId_fkey";',
    "",
    "-- AlterTable",
    'ALTER TABLE "Asset" ADD COLUMN "nickname" TEXT;',
    "",
  ].join("\n");

  const result = stripProtectedDrops(sql);

  assert.deepEqual(result.protectedNames, ["BookingAsset_assetKitId_fkey"]);
  assert.ok(!result.sql.includes("BookingAsset_assetKitId_fkey"));
  // A drop of a foreign key that is not protected is a real schema change.
  assert.ok(
    result.sql.includes(
      'ALTER TABLE "Note" DROP CONSTRAINT "Note_userId_fkey";'
    )
  );
  assert.ok(result.sql.includes('ADD COLUMN "nickname" TEXT;'));
});

test("strips every protected foreign key", () => {
  const sql = PROTECTED_FOREIGN_KEYS.map(
    (name) =>
      `-- DropForeignKey\nALTER TABLE "${
        name.split("_")[0]
      }" DROP CONSTRAINT "${name}";\n`
  ).join("\n");

  const result = stripProtectedDrops(sql);

  assert.deepEqual(result.protectedNames, [...PROTECTED_FOREIGN_KEYS]);
  assert.equal(result.sql.trim(), "");
});

test("strips a generated drop of a protected index", () => {
  const sql = `-- DropIndex\nDROP INDEX "${PROTECTED_INDEXES[0]}";\n\n-- CreateIndex\nCREATE INDEX "Asset_title_idx" ON "Asset"("title");\n`;

  const result = stripProtectedDrops(sql);

  assert.deepEqual(result.protectedNames, [PROTECTED_INDEXES[0]]);
  assert.ok(!result.sql.includes("DROP INDEX"));
  assert.ok(result.sql.includes('CREATE INDEX "Asset_title_idx"'));
});

test("leaves a migration without protected drops unchanged", () => {
  const sql =
    '-- AlterTable\nALTER TABLE "Asset" ADD COLUMN "nickname" TEXT;\n';

  assert.deepEqual(stripProtectedDrops(sql), { sql, protectedNames: [] });
});

/**
 * The foreign keys the committed migrations leave in the database, each with
 * the migration that created it, replaying creates, drops and renames in
 * migration order.
 */
function foreignKeysCreatedByMigrations() {
  const migrationsDir = path.join(prismaDir, "migrations");
  const live = new Map<string, string>();
  const migrations = fs
    .readdirSync(migrationsDir)
    .filter((entry) =>
      fs.statSync(path.join(migrationsDir, entry)).isDirectory()
    )
    .sort();

  for (const migration of migrations) {
    const file = path.join(migrationsDir, migration, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    for (const [, name] of sql.matchAll(
      /ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY/gi
    )) {
      live.set(name, migration);
    }
    for (const [, name] of sql.matchAll(
      /DROP CONSTRAINT\s+(?:IF EXISTS\s+)?"([^"]+)"/gi
    )) {
      live.delete(name);
    }
    for (const [, from, to] of sql.matchAll(
      /RENAME CONSTRAINT\s+"([^"]+)"\s+TO\s+"([^"]+)"/gi
    )) {
      const createdIn = live.get(from);
      if (createdIn) {
        live.delete(from);
        live.set(to, createdIn);
      }
    }
  }
  return live;
}

/**
 * The foreign key names Prisma expects from `schema.prisma`: an explicit
 * `map:` name, or the default `<Model>_<field>[_<field>]_fkey`.
 */
function foreignKeysDescribedBySchema() {
  const schema = fs.readFileSync(path.join(prismaDir, "schema.prisma"), "utf8");
  const names = new Set<string>();
  for (const [, model, body] of schema.matchAll(
    /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  )) {
    for (const [, args] of body.matchAll(/@relation\(([^)]*)\)/g)) {
      const fields = /fields:\s*\[([^\]]*)\]/.exec(args);
      if (!fields) continue;
      const mapped = /map:\s*"([^"]+)"/.exec(args);
      const columns = fields[1].split(",").map((field) => field.trim());
      names.add(mapped ? mapped[1] : `${model}_${columns.join("_")}_fkey`);
    }
  }
  return names;
}

test("every foreign key the migrations create is in the schema or protected", () => {
  const described = foreignKeysDescribedBySchema();
  const protectedKeys = new Set<string>(PROTECTED_FOREIGN_KEYS);

  const unprotected = [...foreignKeysCreatedByMigrations()]
    // Implicit many-to-many join tables (`_AssetToTag`) are Prisma's own.
    .filter(([name]) => !name.startsWith("_"))
    .filter(([name]) => !described.has(name) && !protectedKeys.has(name))
    .map(([name, migration]) => `${name} (created in ${migration})`);

  assert.deepEqual(
    unprotected,
    [],
    "These foreign keys exist only in migration SQL, so the next generated " +
      "migration drops them. Add each to PROTECTED_FOREIGN_KEYS in " +
      "protected-indexes.ts, or describe it with an @relation in schema.prisma."
  );
});

test("every protected foreign key still exists and is not in the schema", () => {
  const created = foreignKeysCreatedByMigrations();
  const described = foreignKeysDescribedBySchema();

  for (const name of PROTECTED_FOREIGN_KEYS) {
    assert.ok(created.has(name), `${name} is not created by any migration`);
    assert.ok(
      !described.has(name),
      `${name} is described by schema.prisma, so it no longer needs protecting`
    );
  }
});
