/**
 * The bulk "Update location" save sends assets and kits in two requests. Its
 * result decides whether the list and its scan draft are kept, so a failure in
 * either part must fail the whole save.
 *
 * @see {@link file://./update-location-result.ts}
 */
import { describe, expect, it } from "vitest";
import { foldLocationPart } from "./update-location-result";

const processing = { status: "processing" } as const;

describe("foldLocationPart", () => {
  it("succeeds when every part succeeds", () => {
    const afterAssets = foldLocationPart(processing, {});
    expect(foldLocationPart(afterAssets, {})).toEqual({ status: "success" });
  });

  it("keeps an assets failure when the kits then move", () => {
    const afterAssets = foldLocationPart(processing, {
      error: { message: "Assets could not be moved" },
    });

    expect(foldLocationPart(afterAssets, {})).toEqual({
      status: "error",
      errorMessage: "Assets could not be moved",
    });
  });

  it("fails when the kits fail after the assets moved", () => {
    const afterAssets = foldLocationPart(processing, {});

    expect(
      foldLocationPart(afterAssets, {
        error: { message: "Kits could not be moved" },
      })
    ).toEqual({ status: "error", errorMessage: "Kits could not be moved" });
  });
});
