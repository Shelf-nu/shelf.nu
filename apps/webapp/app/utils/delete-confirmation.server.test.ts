/**
 * The server half of the typed confirmation on bulk deletes.
 *
 * A bulk delete goes through only when the typed number is the number of items
 * it removes: the posted id count for an explicit selection, and the server's
 * own count for a "select all". A refusal is a 400 that carries the number to
 * type, so the dialog can ask for it.
 *
 * @see {@link file://./delete-confirmation.server.ts}
 */
import { describe, expect, it } from "vitest";
import { assertBulkDeleteConfirmed } from "./delete-confirmation.server";
import { ShelfError } from "./error";
import { ALL_SELECTED_KEY } from "./list";

// @vitest-environment node

const KITS = { one: "kit", many: "kits" };

/** Runs the guard and returns what it threw, or null when it let the call by. */
function refusalFor(
  args: Omit<Parameters<typeof assertBulkDeleteConfirmed>[0], "label" | "noun">
) {
  try {
    assertBulkDeleteConfirmed({ ...args, noun: KITS, label: "Kit" });
    return null;
  } catch (cause) {
    return cause as ShelfError;
  }
}

describe("assertBulkDeleteConfirmed: explicit selection", () => {
  it("lets the delete through when the typed number is the number selected", () => {
    expect(
      refusalFor({
        selectedIds: ["k1", "k2", "k3"],
        confirmation: "3",
        matchedCount: 3,
      })
    ).toBeNull();
  });

  it("accepts surrounding spaces, as the dialog does", () => {
    expect(
      refusalFor({ selectedIds: ["k1"], confirmation: " 1 ", matchedCount: 1 })
    ).toBeNull();
  });

  it("expects the posted id count even when fewer rows still exist", () => {
    // Two of the three ids were deleted elsewhere meanwhile: the user still
    // confirmed the three they saw, and the delete removes what is left.
    expect(
      refusalFor({
        selectedIds: ["k1", "k2", "k3"],
        confirmation: "3",
        matchedCount: 1,
      })
    ).toBeNull();
  });

  it("refuses a missing confirmation, naming the number to type", () => {
    const refusal = refusalFor({
      selectedIds: ["k1", "k2"],
      confirmation: undefined,
      matchedCount: 2,
    });

    expect(refusal).toBeInstanceOf(ShelfError);
    expect(refusal).toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      title: "Nothing was deleted",
      message:
        "Nothing was deleted. Type the number of selected kits (2) to confirm.",
      additionalData: { expectedConfirmation: 2, selectAll: false },
    });
  });

  it("refuses a wrong number", () => {
    expect(
      refusalFor({
        selectedIds: ["k1", "k2"],
        confirmation: "3",
        matchedCount: 2,
      })
    ).toMatchObject({ status: 400 });
  });
});

describe("assertBulkDeleteConfirmed: select all", () => {
  it("lets the delete through when the typed number is the server's count", () => {
    expect(
      refusalFor({
        selectedIds: ["k1", ALL_SELECTED_KEY],
        confirmation: "40",
        matchedCount: 40,
      })
    ).toBeNull();
  });

  it("refuses a stale tab that posts no confirmation", () => {
    expect(
      refusalFor({
        selectedIds: [ALL_SELECTED_KEY],
        confirmation: null,
        matchedCount: 40,
      })
    ).toMatchObject({
      status: 400,
      additionalData: { expectedConfirmation: 40, selectAll: true },
    });
  });

  it("refuses when the list now matches more than the user typed, and says how many", () => {
    // The dialog showed 12; three matching kits were added since it opened.
    const refusal = refusalFor({
      selectedIds: [ALL_SELECTED_KEY],
      confirmation: "12",
      matchedCount: 15,
    });

    expect(refusal).toMatchObject({
      status: 400,
      message:
        "Nothing was deleted. Your selection matches 15 kits, not 12. Type 15 to delete them.",
      additionalData: { expectedConfirmation: 15 },
    });
  });

  it("uses the singular noun for one item", () => {
    expect(
      refusalFor({
        selectedIds: [ALL_SELECTED_KEY],
        confirmation: "2",
        matchedCount: 1,
      })?.message
    ).toBe(
      "Nothing was deleted. Your selection matches 1 kit, not 2. Type 1 to delete them."
    );
  });

  it("never matches the posted id count instead of the server's", () => {
    // Two page rows plus the sentinel are three posted values; the server's
    // count is what the delete would remove.
    expect(
      refusalFor({
        selectedIds: ["k1", "k2", ALL_SELECTED_KEY],
        confirmation: "3",
        matchedCount: 80,
      })
    ).toMatchObject({ status: 400 });
  });
});
