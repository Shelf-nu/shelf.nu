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

// Prisma writes schema-qualified names, as committed migrations since
// 20250806090215 show.
test("strips a schema-qualified drop of a protected foreign key", () => {
  const sql =
    '-- DropForeignKey\nALTER TABLE "public"."BookingAsset" DROP CONSTRAINT "BookingAsset_assetKitId_fkey";\n\n-- AlterTable\nALTER TABLE "public"."Asset" ADD COLUMN "nickname" TEXT;\n';

  const result = stripProtectedDrops(sql);

  assert.deepEqual(result.protectedNames, ["BookingAsset_assetKitId_fkey"]);
  assert.ok(!result.sql.includes("DROP CONSTRAINT"));
  assert.ok(!result.sql.includes("-- DropForeignKey"));
  assert.ok(result.sql.includes('ADD COLUMN "nickname" TEXT;'));
});

test("strips a schema-qualified drop of a protected index", () => {
  const sql = `-- DropIndex\nDROP INDEX "public"."${PROTECTED_INDEXES[0]}";\n`;

  const result = stripProtectedDrops(sql);

  assert.deepEqual(result.protectedNames, [PROTECTED_INDEXES[0]]);
  assert.equal(result.sql.trim(), "");
});

test("leaves no blank lines where it removed drops", () => {
  // The shape Prisma generates: blocks separated by one blank line.
  const sql = [
    "-- DropForeignKey",
    'ALTER TABLE "BookingAsset" DROP CONSTRAINT "BookingAsset_assetKitId_fkey";',
    "",
    "-- DropForeignKey",
    'ALTER TABLE "ConsumptionLog" DROP CONSTRAINT "ConsumptionLog_bookingAssetId_fkey";',
    "",
    "-- DropIndex",
    'DROP INDEX "Note_content_idx";',
    "",
    "-- DropForeignKey",
    'ALTER TABLE "BookingAsset" DROP CONSTRAINT "BookingAsset_sourceKitId_fkey";',
    "",
    "-- AlterTable",
    'ALTER TABLE "Tag" ADD COLUMN "qaProbe" TEXT;',
    "",
  ].join("\n");

  assert.equal(
    stripProtectedDrops(sql).sql,
    [
      "-- DropIndex",
      'DROP INDEX "Note_content_idx";',
      "",
      "-- AlterTable",
      'ALTER TABLE "Tag" ADD COLUMN "qaProbe" TEXT;',
      "",
    ].join("\n")
  );
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
    replayForeignKeyStatements(fs.readFileSync(file, "utf8"), migration, live);
  }
  return live;
}

/**
 * Applies one migration's foreign key statements to `live`, a map of
 * foreign key name to the migration that created it.
 *
 * Dropping a table drops its foreign keys too. A key is matched to its table
 * by name: Prisma names every foreign key `<Table>_<column>_fkey`, and the
 * hand-written ones in `PROTECTED_FOREIGN_KEYS` follow the same convention.
 */
function replayForeignKeyStatements(
  sql: string,
  migration: string,
  live: Map<string, string>
) {
  // One pattern, applied in the order the statements appear: a migration that
  // drops a key and adds it again must leave it in place.
  const statements =
    /ADD CONSTRAINT\s+"([^"]+)"\s+FOREIGN KEY|DROP CONSTRAINT\s+(?:IF EXISTS\s+)?"([^"]+)"|RENAME CONSTRAINT\s+"([^"]+)"\s+TO\s+"([^"]+)"|DROP TABLE\s+(?:IF EXISTS\s+)?(?:"[^"]+"\.)?"([^"]+)"/gi;
  // Hand-written migrations explain themselves in comments; a statement quoted
  // in one never ran.
  const code = sql.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, "");
  for (const [
    ,
    added,
    dropped,
    renamedFrom,
    renamedTo,
    droppedTable,
  ] of code.matchAll(statements)) {
    if (added) {
      live.set(added, migration);
    } else if (dropped) {
      live.delete(dropped);
    } else if (droppedTable) {
      for (const name of [...live.keys()]) {
        if (name.startsWith(`${droppedTable}_`)) live.delete(name);
      }
    } else if (renamedFrom && renamedTo) {
      const createdIn = live.get(renamedFrom);
      if (createdIn) {
        live.delete(renamedFrom);
        live.set(renamedTo, createdIn);
      }
    }
  }
}

test("keeps a foreign key that a migration drops and adds again", () => {
  // Prisma changes a foreign key's ON DELETE by dropping and re-adding it.
  const live = new Map<string, string>([["Location_imageId_fkey", "first"]]);

  replayForeignKeyStatements(
    [
      'ALTER TABLE "Location" DROP CONSTRAINT "Location_imageId_fkey";',
      'ALTER TABLE "Location" ADD CONSTRAINT "Location_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE SET NULL;',
    ].join("\n"),
    "second",
    live
  );

  assert.equal(live.get("Location_imageId_fkey"), "second");
});

test("forgets the foreign keys of a table a migration drops", () => {
  const live = new Map<string, string>([
    ["PdfDocument_organizationId_fkey", "first"],
    ["PdfTemplate_organizationId_fkey", "first"],
  ]);

  replayForeignKeyStatements('DROP TABLE "PdfDocument";', "second", live);

  assert.deepEqual([...live.keys()], ["PdfTemplate_organizationId_fkey"]);
});

test("ignores constraint statements inside SQL comments", () => {
  const live = new Map<string, string>([["Location_imageId_fkey", "first"]]);

  replayForeignKeyStatements(
    [
      '-- An earlier draft ran: ALTER TABLE "Location" DROP CONSTRAINT "Location_imageId_fkey";',
      '/* Do not run: ALTER TABLE "Location" DROP CONSTRAINT "Location_imageId_fkey"; */',
      "SELECT 1;",
    ].join("\n"),
    "second",
    live
  );

  assert.equal(live.get("Location_imageId_fkey"), "first");
});

test("removes a foreign key that a migration adds and drops again", () => {
  const live = new Map<string, string>();

  replayForeignKeyStatements(
    [
      'ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id");',
      'ALTER TABLE "Note" DROP CONSTRAINT "Note_userId_fkey";',
    ].join("\n"),
    "only",
    live
  );

  assert.equal(live.has("Note_userId_fkey"), false);
});

/**
 * The foreign key names Prisma expects from `schema.prisma`: an explicit
 * `map:` name, or the default `<table>_<column>[_<column>]_fkey`, built from
 * database names, so a model's `@@map` and a field's `@map` apply.
 */
function foreignKeysDescribedBySchema(
  source = fs.readFileSync(path.join(prismaDir, "schema.prisma"), "utf8")
) {
  // A relation in a `//` or `///` comment is not part of the schema.
  const schema = source.replace(/\/\/.*$/gm, "");
  const names = new Set<string>();
  for (const [, model, body] of schema.matchAll(
    /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  )) {
    const table = /@@map\(\s*"([^"]+)"\s*\)/.exec(body)?.[1] ?? model;
    const columnOf = new Map<string, string>();
    for (const [, field, column] of body.matchAll(
      /^\s*(\w+)\s[^\n]*?[^@]@map\(\s*"([^"]+)"\s*\)/gm
    )) {
      columnOf.set(field, column);
    }
    for (const [, args] of body.matchAll(/@relation\(([^)]*)\)/g)) {
      const fields = /fields:\s*\[([^\]]*)\]/.exec(args);
      if (!fields) continue;
      const mapped = /map:\s*"([^"]+)"/.exec(args);
      const columns = fields[1]
        .split(",")
        .map((field) => field.trim())
        .map((field) => columnOf.get(field) ?? field);
      names.add(mapped ? mapped[1] : `${table}_${columns.join("_")}_fkey`);
    }
  }
  return names;
}

test("names schema foreign keys after database table and column names", () => {
  const schema = [
    "model Note {",
    '  ownerId String @map("owner_id")',
    "  owner   User   @relation(fields: [ownerId], references: [id])",
    "  tagId   String",
    '  tag     Tag    @relation(fields: [tagId], references: [id], map: "note_tag_fk")',
    "}",
    "",
    "model Comment {",
    "  noteId String",
    "  note   Note   @relation(fields: [noteId], references: [id])",
    '  @@map("comments")',
    "}",
  ].join("\n");

  assert.deepEqual(
    [...foreignKeysDescribedBySchema(schema)].sort(),
    ["Note_owner_id_fkey", "comments_noteId_fkey", "note_tag_fk"].sort()
  );
});

test("ignores relations inside schema comments", () => {
  const schema = [
    "model Note {",
    "  ownerId String",
    "  // owner User @relation(fields: [ownerId], references: [id])",
    "}",
  ].join("\n");

  assert.deepEqual([...foreignKeysDescribedBySchema(schema)], []);
});

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
