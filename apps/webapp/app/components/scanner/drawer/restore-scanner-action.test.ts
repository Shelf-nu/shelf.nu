/**
 * The bulk scanner returns a restored list to the action it was parked under,
 * but only to one the user may still use, and never to "View asset", which
 * shows no list.
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

  it("does not restore an action the user's role no longer allows", () => {
    expect(
      scannerActionToRestore("Assign custody", [
        "View asset",
        "Update location",
      ])
    ).toBeNull();
  });

  it("does not restore View asset, which shows no list", () => {
    expect(scannerActionToRestore(VIEW_ASSET_ACTION, ALL)).toBeNull();
  });

  it("ignores a value that is no scanner action at all", () => {
    expect(scannerActionToRestore("Delete everything", ALL)).toBeNull();
  });

  it("stays put when no action was saved with the draft", () => {
    expect(scannerActionToRestore(null, ALL)).toBeNull();
  });
});
