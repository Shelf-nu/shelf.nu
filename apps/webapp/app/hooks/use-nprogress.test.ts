/**
 * Tests for `isFetcherExcludedFromProgress`: which fetchers stay off the
 * global progress bar because their UI shows its own feedback.
 *
 * @see {@link file://./use-nprogress.ts}
 */
import { describe, expect, it } from "vitest";

import { isFetcherExcludedFromProgress } from "./use-nprogress";

describe("isFetcherExcludedFromProgress", () => {
  it("keeps the scan history sheet's fetchers off the bar, for assets and kits", () => {
    // The sheet shows its own spinner while a page loads.
    expect(isFetcherExcludedFromProgress("scan-history-asset:asset-1")).toBe(
      true
    );
    expect(isFetcherExcludedFromProgress("scan-history-kit:kit-1")).toBe(true);
  });

  it("keeps the record arrows' neighbours load off the bar", () => {
    // The arrows stay disabled while it loads.
    expect(
      isFetcherExcludedFromProgress("record-navigation-asset-asset-1")
    ).toBe(true);
  });

  it("keeps the adjust dialog's From section load off the bar", () => {
    // The section stays hidden until its data arrives.
    expect(
      isFetcherExcludedFromProgress(
        "adjust-booking-asset-sources-booking-1-asset-1"
      )
    ).toBe(true);
    // The dialog's own save keeps moving the bar.
    expect(isFetcherExcludedFromProgress("adjust-booking-asset-asset-1")).toBe(
      false
    );
  });

  it("keeps a listed fetcher off the bar", () => {
    expect(isFetcherExcludedFromProgress("add-note")).toBe(true);
  });

  it("lets any other fetcher move the bar", () => {
    expect(isFetcherExcludedFromProgress("assign-custody")).toBe(false);
  });
});
