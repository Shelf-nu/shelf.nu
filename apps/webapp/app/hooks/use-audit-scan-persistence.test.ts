/**
 * Behavior tests for {@link useAuditScanPersistence}'s non-asset guard.
 *
 * Audits only track assets — kits have no `AuditAsset` record, so
 * submitting a kit's id as `assetId` to `/api/audits/record-scan` would
 * fail server-side and (since the hook retries the first un-persisted
 * item on every effect run) hang the "Saving scans" indicator forever.
 * The normal path already keeps kits out of `scannedItems` with `data`
 * populated (see the `rejectItemType` guard in `generic-item-row.tsx`),
 * but this hook defends independently: it must never submit an item
 * whose `type` isn't `"asset"`, regardless of how it entered the map.
 *
 * Also covers quantity-tracked scans: one is held back until the count dialog
 * has given it a count, then sent with `foundQuantity`.
 *
 * @see {@link file://./use-audit-scan-persistence.ts}
 * @see {@link file://../components/scanner/drawer/generic-item-row.tsx}
 */
import { renderHook } from "@testing-library/react";
import type { FetcherWithComponents } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { AuditSessionInfo, ScanListItems } from "~/atoms/qr-scanner";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { useAuditScanPersistence } from "./use-audit-scan-persistence";

const auditSession: Exclude<AuditSessionInfo, null> = {
  id: "audit-1",
  name: "Test Audit",
  expectedAssetCount: 1,
  foundAssetCount: 0,
  missingAssetCount: 1,
  unexpectedAssetCount: 0,
};

// why: a real `useFetcher()` fetcher requires a full react-router data
// router context. The hook only reads `.state`/`.data` and calls
// `.submit()`, so a minimal object satisfying that shape is enough to
// observe whether persistence attempted a submit.
function makeFetcher(
  overrides: Partial<FetcherWithComponents<unknown>> = {}
): FetcherWithComponents<unknown> {
  return {
    state: "idle",
    data: undefined,
    submit: vi.fn(),
    ...overrides,
  } as unknown as FetcherWithComponents<unknown>;
}

function makeRefs() {
  return {
    persistedItemsRef: { current: new Set<string>() },
    pendingPersistsRef: { current: new Map<string, string>() },
    isRestoringRef: { current: false },
    auditCounts: {},
    onCountRequired: vi.fn(),
  };
}

describe("useAuditScanPersistence", () => {
  it("does not submit a kit's id as assetId", () => {
    const fetcher = makeFetcher();
    const refs = makeRefs();
    const scannedItems: ScanListItems = {
      "qr-kit": {
        data: { id: "kit-1", name: "Kit A" } as unknown as KitFromQr,
        type: "kit",
      },
    };

    renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
      })
    );

    expect(fetcher.submit).not.toHaveBeenCalled();
  });

  it("still submits a scanned asset's id as assetId (regression guard)", () => {
    const fetcher = makeFetcher();
    const refs = makeRefs();
    const scannedItems: ScanListItems = {
      "qr-asset": {
        data: { id: "asset-1", title: "Asset A" } as unknown as AssetFromQr,
        type: "asset",
      },
    };

    renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
      })
    );

    expect(fetcher.submit).toHaveBeenCalledTimes(1);
    const [formData] = (fetcher.submit as ReturnType<typeof vi.fn>).mock
      .calls[0] as [FormData, unknown];
    expect(formData.get("assetId")).toBe("asset-1");
  });

  it("skips a kit but still submits a co-scanned asset in the same batch", () => {
    const fetcher = makeFetcher();
    const refs = makeRefs();
    const scannedItems: ScanListItems = {
      "qr-kit": {
        data: { id: "kit-1", name: "Kit A" } as unknown as KitFromQr,
        type: "kit",
      },
      "qr-asset": {
        data: { id: "asset-1", title: "Asset A" } as unknown as AssetFromQr,
        type: "asset",
      },
    };

    renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
      })
    );

    expect(fetcher.submit).toHaveBeenCalledTimes(1);
    const [formData] = (fetcher.submit as ReturnType<typeof vi.fn>).mock
      .calls[0] as [FormData, unknown];
    expect(formData.get("assetId")).toBe("asset-1");
  });

  it("holds a quantity-tracked scan back until it has a count", () => {
    const fetcher = makeFetcher();
    const refs = makeRefs();
    const scannedItems: ScanListItems = {
      "qr-pool": {
        data: {
          id: "pool-1",
          title: "Sandbag",
          type: "QUANTITY_TRACKED",
          quantity: 14,
        } as unknown as AssetFromQr,
        type: "asset",
      },
    };

    renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
      })
    );

    expect(fetcher.submit).not.toHaveBeenCalled();
  });

  it("sends the count with a counted quantity-tracked scan", () => {
    const fetcher = makeFetcher();
    const refs = makeRefs();
    // A restored row carries no asset type; its count entry marks it.
    const scannedItems: ScanListItems = {
      "qr-pool": {
        data: { id: "pool-1", title: "Sandbag" } as unknown as AssetFromQr,
        type: "asset",
      },
    };

    renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
        auditCounts: {
          "pool-1": {
            expectedQuantity: 14,
            foundQuantity: 0,
            unitOfMeasure: "pcs",
          },
        },
      })
    );

    expect(fetcher.submit).toHaveBeenCalledTimes(1);
    const [formData] = (fetcher.submit as ReturnType<typeof vi.fn>).mock
      .calls[0] as [FormData, unknown];
    // Zero is a count, not a missing one.
    expect(formData.get("foundQuantity")).toBe("0");
  });

  it("does not send a count for an individual asset", () => {
    const fetcher = makeFetcher();
    const refs = makeRefs();
    const scannedItems: ScanListItems = {
      "qr-asset": {
        data: {
          id: "asset-1",
          title: "Camera",
          type: "INDIVIDUAL",
        } as unknown as AssetFromQr,
        type: "asset",
      },
    };

    renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
      })
    );

    const [formData] = (fetcher.submit as ReturnType<typeof vi.fn>).mock
      .calls[0] as [FormData, unknown];
    expect(formData.has("foundQuantity")).toBe(false);
  });

  it("hands a count-required answer to the caller and frees the scan to retry", () => {
    const onCountRequired = vi.fn();
    const refs = makeRefs();
    refs.pendingPersistsRef.current.set("pool-1", "qr-pool");
    const answer = {
      success: false,
      status: "count-required",
      assetId: "pool-1",
      assetTitle: "Sandbag",
      expectedQuantity: 14,
      foundQuantity: null,
      unitOfMeasure: "pcs",
    };
    const fetcher = makeFetcher({ data: answer });

    renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems: {},
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
        onCountRequired,
      })
    );

    expect(onCountRequired).toHaveBeenCalledWith(answer);
    expect(refs.pendingPersistsRef.current.size).toBe(0);
    expect(refs.persistedItemsRef.current.has("pool-1")).toBe(false);
  });
});
