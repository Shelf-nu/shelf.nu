/**
 * Enum-parity regression guard.
 *
 * The package deliberately re-declares its `Qt*` string-union enums instead of
 * importing `@prisma/client` (zero runtime deps, Metro-safe). That freedom is
 * only safe if the literals stay byte-identical to the database enums, so this
 * test reads each enum's members straight from
 * `packages/database/prisma/schema.prisma` and compares them with the matching
 * `QT_*` array. A value added to, removed from or renamed in the schema fails
 * here until the package array follows. The schema is read as text, so the
 * test needs no generated Prisma client.
 *
 * @see {@link file://../../database/prisma/schema.prisma}
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  QT_ASSET_TYPES,
  QT_BOOKING_STATUSES,
  QT_CONSUMPTION_CATEGORIES,
  QT_CONSUMPTION_TYPES,
} from "./types";

const schema = readFileSync(
  new URL("../../database/prisma/schema.prisma", import.meta.url),
  "utf8"
);

/**
 * The members of `enum <name> { ... }` in the schema, in declaration order.
 * Comments and attributes (`@map`, `@@map`) are ignored.
 */
function schemaEnum(name: string): string[] {
  const block = new RegExp(`^enum\\s+${name}\\s*\\{([\\s\\S]*?)^\\}`, "m").exec(
    schema
  );
  assert.ok(block, `enum ${name} not found in schema.prisma`);
  return block[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line && !line.startsWith("@@"))
    .map((line) => line.split(/\s+/)[0]);
}

/** Compares two string lists as sets (order-independent, duplicate-free). */
function assertSameSet(actual: readonly string[], expected: readonly string[]) {
  assert.deepEqual([...new Set(actual)].sort(), [...new Set(expected)].sort());
}

const PAIRS = [
  ["AssetType", QT_ASSET_TYPES],
  ["ConsumptionType", QT_CONSUMPTION_TYPES],
  ["ConsumptionCategory", QT_CONSUMPTION_CATEGORIES],
  ["BookingStatus", QT_BOOKING_STATUSES],
] as const;

for (const [name, members] of PAIRS) {
  test(`QT array equals schema enum ${name}`, () => {
    assertSameSet(members, schemaEnum(name));
  });
}

test("reads enum members from the schema, comments and all", () => {
  assert.ok(schemaEnum("ConsumptionCategory").includes("CONVERTED"));
  assert.ok(schemaEnum("ConsumptionCategory").includes("OPENING_BALANCE"));
});

test("no QT_* array has duplicate members", () => {
  for (const [, arr] of PAIRS) {
    assert.equal(new Set(arr).size, arr.length);
  }
});
