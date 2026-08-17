/**
 * Mobile bulk id lists — select-all sentinel rejection
 *
 * Mobile has no select-all control and sends no `currentSearchParams`. If the
 * `ALL_SELECTED_KEY` sentinel reaches a mobile bulk endpoint it expands against
 * an EMPTY filter — every matching row in the organization — so the schema has
 * to refuse it rather than the service having to cope.
 *
 * That is reachable by SELF_SERVICE, which holds `asset:custody` and
 * `kit:custody`, so on the custody endpoints it is a privilege escalation
 * rather than merely an unbounded write.
 *
 * Regression coverage for detail.dev finding D130.
 *
 * @see {@link file://./mobile-bulk-ids.server.ts}
 */

import { describe, expect, it } from "vitest";

import { ALL_SELECTED_KEY } from "~/utils/list";
import { mobileBulkIdsSchema } from "./mobile-bulk-ids.server";

// @vitest-environment node

const schema = mobileBulkIdsSchema("assetIds");

describe("mobileBulkIdsSchema", () => {
  it("accepts explicit ids", () => {
    expect(schema.parse(["a1", "a2"])).toEqual(["a1", "a2"]);
  });

  it("rejects the select-all sentinel on its own", () => {
    expect(schema.safeParse([ALL_SELECTED_KEY]).success).toBe(false);
  });

  it("rejects the sentinel hidden among real ids", () => {
    // The services check `ids.includes(ALL_SELECTED_KEY)`, so one sentinel
    // anywhere in the array switches the whole request to select-all.
    expect(schema.safeParse(["a1", ALL_SELECTED_KEY, "a2"]).success).toBe(
      false
    );
  });

  it("still rejects an empty list", () => {
    expect(schema.safeParse([]).success).toBe(false);
  });

  it("explains itself in the error", () => {
    const result = schema.safeParse([ALL_SELECTED_KEY]);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/select all/i);
      expect(result.error.issues[0].message).toContain("assetIds");
    }
  });

  it("names the field it was built for", () => {
    const kits = mobileBulkIdsSchema("kitIds").safeParse([ALL_SELECTED_KEY]);

    expect(kits.success).toBe(false);
    if (!kits.success) {
      expect(kits.error.issues[0].message).toContain("kitIds");
    }
  });

  it("does not reject ids that merely contain the sentinel as a substring", () => {
    // A real cuid could in principle embed the string; only an exact match is
    // the sentinel.
    expect(schema.parse(["all-selected-but-not-really"])).toEqual([
      "all-selected-but-not-really",
    ]);
  });
});
