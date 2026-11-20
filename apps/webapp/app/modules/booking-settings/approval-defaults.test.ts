/**
 * Booking approval is opt-in per workspace: a fresh workspace's settings row
 * carries both approval switches off, so no reservation is a request until an
 * owner or administrator turns one on. The defaults live in the database
 * (schema and the migration that adds the columns); these assertions read
 * both, so a default flipped back in either place fails here.
 *
 * @see {@link file://../../../../../packages/database/prisma/schema.prisma}
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createBookingSettings } from "@factories";
import { isBookingApprovalEnabled } from "~/utils/bookings";

// @vitest-environment node

const ROOT = new URL("../../../../../", import.meta.url);

/** Reads a file relative to the repository root. */
function readFromRoot(path: string) {
  return readFileSync(fileURLToPath(new URL(path, ROOT)), "utf8");
}

describe("booking approval defaults", () => {
  it("declares both switches off by default in the schema", () => {
    const schema = readFromRoot("packages/database/prisma/schema.prisma");
    expect(schema).toMatch(
      /requireApprovalForBase\s+Boolean\s+@default\(false\)/
    );
    expect(schema).toMatch(
      /requireApprovalForSelfService\s+Boolean\s+@default\(false\)/
    );
  });

  it("adds both columns off by default in the migration", () => {
    const migration = readFromRoot(
      "packages/database/prisma/migrations/20261110120000_booking_approval_per_role/migration.sql"
    );
    expect(migration).toMatch(
      /"requireApprovalForBase" BOOLEAN NOT NULL DEFAULT false/
    );
    expect(migration).toMatch(
      /"requireApprovalForSelfService" BOOLEAN NOT NULL DEFAULT false/
    );
  });

  it("reads a fresh workspace as not requiring approval", () => {
    // The factory mirrors the schema defaults for the service tests.
    expect(isBookingApprovalEnabled(createBookingSettings())).toBe(false);
  });
});
