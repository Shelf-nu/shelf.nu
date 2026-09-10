/**
 * Tests for the kit list row helpers.
 *
 * The rows these helpers read reach the UI through `selectedBulkItemsAtom`,
 * which types every field as `any`, so the compiler cannot tell a helper that
 * reads the right field from one that reads a field the loader never sends.
 * These assertions are that check.
 *
 * @see {@link file://./kits.ts}
 */

import type { AssetStatus } from "@prisma/client";
import { someKitMemberBlocksCustodyAssignment } from "./kits";

let nextKitId = 0;

/**
 * Builds a kit list row carrying the given member statuses, shaped exactly as
 * the kits index loader supplies it — membership as `AssetKit` pivot rows
 * (`assetKits[].asset`), never a flat asset array.
 *
 * @see {@link file://./../routes/_layout+/kits._index.tsx}
 */
const kitRow = (...statuses: AssetStatus[]) => ({
  id: `kit-${(nextKitId += 1)}`,
  assetKits: statuses.map((status) => ({ asset: { status } })),
});

describe("someKitMemberBlocksCustodyAssignment", () => {
  it("blocks when a member asset is checked out", () => {
    expect(
      someKitMemberBlocksCustodyAssignment([kitRow("AVAILABLE", "CHECKED_OUT")])
    ).toBe(true);
  });

  it("blocks when a member asset is in custody", () => {
    expect(
      someKitMemberBlocksCustodyAssignment([kitRow("AVAILABLE", "IN_CUSTODY")])
    ).toBe(true);
  });

  it("blocks when only one of several selected kits has a blocked member", () => {
    expect(
      someKitMemberBlocksCustodyAssignment([
        kitRow("AVAILABLE"),
        kitRow("AVAILABLE", "IN_CUSTODY"),
      ])
    ).toBe(true);
  });

  it("allows when every member asset is available", () => {
    expect(
      someKitMemberBlocksCustodyAssignment([
        kitRow("AVAILABLE", "AVAILABLE"),
        kitRow("AVAILABLE"),
      ])
    ).toBe(false);
  });

  it("allows an empty selection", () => {
    expect(someKitMemberBlocksCustodyAssignment([])).toBe(false);
  });

  it("allows a kit with no members", () => {
    expect(someKitMemberBlocksCustodyAssignment([kitRow()])).toBe(false);
  });

  it("allows rows the client never loaded, which the server re-validates", () => {
    // "Select all across pages" selects rows with no membership payload. The
    // guard is an affordance; `assetKits` being absent must not throw.
    expect(someKitMemberBlocksCustodyAssignment([{ id: "kit-unloaded" }])).toBe(
      false
    );
  });
});
