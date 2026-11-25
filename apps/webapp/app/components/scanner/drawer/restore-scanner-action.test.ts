/**
 * The bulk scanner returns a restored list to the action it was parked under,
 * but only to one the user may still use, and never to "View asset", which
 * shows no list. When it cannot, the list is shown under an action the user
 * may use, so it never sits out of sight.
 *
 * @see {@link file://./restore-scanner-action.ts}
 */
import { describe, expect, it } from "vitest";
import type { ActionType } from "./action-switcher";
import {
  scannerActionToRestore,
  VIEW_ASSET_ACTION,
} from "./restore-scanner-action";

const ALL: ActionType[] = [
  "View asset",
  "Assign custody",
  "Release custody",
  "Update location",
];

describe("scannerActionToRestore", () => {
  it("returns to the action the list was parked under", () => {
    expect(scannerActionToRestore("Assign custody", ALL)).toBe(
      "Assign custody"
    );
  });

  it("does not restore an action the user's role no longer allows, and shows the list under one it does", () => {
    expect(
      scannerActionToRestore("Assign custody", [
        "View asset",
        "Update location",
      ])
    ).toBe("Update location");
  });

  it("does not restore View asset, which shows no list", () => {
    expect(scannerActionToRestore(VIEW_ASSET_ACTION, ALL)).toBe(
      "Assign custody"
    );
  });

  it("ignores a value that is no scanner action at all", () => {
    expect(scannerActionToRestore("Delete everything", ALL)).toBe(
      "Assign custody"
    );
  });

  it("shows the list when no action was saved with the draft", () => {
    expect(scannerActionToRestore(null, ALL)).toBe("Assign custody");
  });

  it("stays put when the role allows no action that shows a list", () => {
    expect(scannerActionToRestore("Assign custody", ["View asset"])).toBeNull();
  });
});
