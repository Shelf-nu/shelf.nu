/**
 * Bulk Remove Asset/Kit Dialog — payload contract
 *
 * Covers the wire format between the booking-overview bulk-remove dialog and
 * its action handler. The dialog submits two parallel arrays: every selected
 * row's id (`assetOrKitIds`) plus, separately, the asset ids whose *standalone*
 * booking row was ticked (`standaloneAssetIds`).
 *
 * That second array is the only thing that tells the server a user ticked an
 * asset's own row rather than the row being dragged in by a ticked kit — the
 * distinction that decides whether an asset booked BOTH standalone and inside
 * a kit gets fully removed. It is easy to break silently (a renamed field, a
 * dropped hidden input, and the payload still parses), so the shape is pinned
 * here.
 *
 * @see {@link file://./bulk-remove-asset-and-kit-dialog.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx}
 */
import { parseData } from "~/utils/http.server";
import { BulkRemoveAssetsAndKitSchema } from "./bulk-remove-asset-and-kit-dialog";

/** Builds the FormData the dialog's hidden inputs produce. */
function buildFormData({
  assetOrKitIds,
  standaloneAssetIds,
}: {
  assetOrKitIds: string[];
  standaloneAssetIds?: string[];
}) {
  const formData = new FormData();
  assetOrKitIds.forEach((id, i) => {
    formData.append(`assetOrKitIds[${i}]`, id);
  });
  standaloneAssetIds?.forEach((id, i) => {
    formData.append(`standaloneAssetIds[${i}]`, id);
  });
  return formData;
}

describe("BulkRemoveAssetsAndKitSchema", () => {
  it("parses the indexed hidden inputs into both arrays", () => {
    const parsed = parseData(
      buildFormData({
        assetOrKitIds: ["asset-1", "kit-1", "asset-in-kit"],
        standaloneAssetIds: ["asset-1"],
      }),
      BulkRemoveAssetsAndKitSchema
    );

    expect(parsed.assetOrKitIds).toEqual(["asset-1", "kit-1", "asset-in-kit"]);
    expect(parsed.standaloneAssetIds).toEqual(["asset-1"]);
  });

  it("keeps an asset in standaloneAssetIds even when it is also a kit member", () => {
    // The overlapping case: `asset-both` sits on the booking as its own row
    // AND inside `kit-1`. Ticking both rows must survive the round-trip, or
    // the server falls back to inference and spares the standalone row.
    const parsed = parseData(
      buildFormData({
        assetOrKitIds: ["asset-both", "kit-1"],
        standaloneAssetIds: ["asset-both"],
      }),
      BulkRemoveAssetsAndKitSchema
    );

    expect(parsed.standaloneAssetIds).toEqual(["asset-both"]);
  });

  it("defaults standaloneAssetIds to an empty array when the field is absent", () => {
    // Older clients (and any caller that can't observe per-row selection)
    // omit the field entirely; the handler then falls back to inferring
    // standalone intent from kit membership.
    const parsed = parseData(
      buildFormData({ assetOrKitIds: ["kit-1"] }),
      BulkRemoveAssetsAndKitSchema
    );

    expect(parsed.standaloneAssetIds).toEqual([]);
  });

  it("rejects an empty selection", () => {
    expect(() =>
      parseData(
        buildFormData({ assetOrKitIds: [] }),
        BulkRemoveAssetsAndKitSchema
      )
    ).toThrow();
  });
});
