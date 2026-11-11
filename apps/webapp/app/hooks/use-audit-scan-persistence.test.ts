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
    onCountSaved: vi.fn(),
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

  it("marks every request as coming from a scanner that asks for counts", () => {
    const fetcher = makeFetcher();
    const refs = makeRefs();

    renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems: {
          "qr-asset": {
            data: { id: "asset-1", title: "Camera" } as unknown as AssetFromQr,
            type: "asset",
          },
        },
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
      })
    );

    const [formData] = (fetcher.submit as ReturnType<typeof vi.fn>).mock
      .calls[0] as [FormData, unknown];
    // why: the server records count-less scans uncounted only for pages that
    // lack this marker (loaded before audits counted units).
    expect(formData.get("countAware")).toBe("1");
  });

  it("sends a recount again when it was saved while the first count was in flight", () => {
    const refs = makeRefs();
    const pool = {
      "qr-pool": {
        data: { id: "pool-1", title: "Sandbag" } as unknown as AssetFromQr,
        type: "asset" as const,
      },
    };
    let fetcher = makeFetcher();
    let counts = {
      "pool-1": {
        expectedQuantity: 14,
        foundQuantity: 8,
        unitOfMeasure: "pcs",
      },
    };

    const { rerender } = renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems: pool,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
        auditCounts: counts,
      })
    );
    expect(refs.pendingPersistsRef.current.has("pool-1")).toBe(true);

    // The auditor recounts to 6 while the request carrying 8 is in flight,
    // then the server answers that 8 was saved.
    counts = {
      "pool-1": {
        expectedQuantity: 14,
        foundQuantity: 6,
        unitOfMeasure: "pcs",
      },
    };
    fetcher = makeFetcher({
      state: "idle",
      data: { success: true, foundQuantity: 8 },
    });
    rerender();

    expect(refs.persistedItemsRef.current.has("pool-1")).toBe(false);
    const lastSubmit = (
      fetcher.submit as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1) as [FormData, unknown] | undefined;
    expect(lastSubmit?.[0].get("foundQuantity")).toBe("6");
  });

  it("reports counts the server refused to save, with its message", () => {
    const refs = makeRefs();
    const onCountFailed = vi.fn();
    const counts = {
      "pool-1": {
        expectedQuantity: 14,
        foundQuantity: 9,
        unitOfMeasure: "pcs",
        unsaved: true,
      },
    };
    let fetcher = makeFetcher();
    const pool = {
      "qr-pool": {
        data: { id: "pool-1", title: "Sandbag" } as unknown as AssetFromQr,
        type: "asset" as const,
      },
    };

    const { rerender } = renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems: pool,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
        auditCounts: counts,
        onCountFailed,
      })
    );
    fetcher = makeFetcher({
      state: "idle",
      data: { error: { message: "This audit is archived." }, refused: true },
    });
    rerender();

    expect(onCountFailed).toHaveBeenCalledWith(
      ["pool-1"],
      "This audit is archived."
    );
  });

  it("keeps a count pending through a transient server failure", () => {
    const refs = makeRefs();
    const onCountFailed = vi.fn();
    const counts = {
      "pool-1": {
        expectedQuantity: 14,
        foundQuantity: 9,
        unitOfMeasure: "pcs",
        unsaved: true,
      },
    };
    let fetcher = makeFetcher();
    const pool = {
      "qr-pool": {
        data: { id: "pool-1", title: "Sandbag" } as unknown as AssetFromQr,
        type: "asset" as const,
      },
    };

    const { rerender } = renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems: pool,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
        auditCounts: counts,
        onCountFailed,
      })
    );
    fetcher = makeFetcher({
      state: "idle",
      data: {
        error: { message: "Failed to record audit scan" },
        refused: false,
      },
    });
    rerender();

    expect(onCountFailed).not.toHaveBeenCalled();
  });

  it("reports the count the server kept when it differs from the one sent", () => {
    const refs = makeRefs();
    const onCountSaved = vi.fn();
    refs.pendingPersistsRef.current.set("pool-1", "qr-pool");
    const counts = {
      "pool-1": {
        expectedQuantity: 14,
        foundQuantity: 9,
        unitOfMeasure: "pcs",
      },
    };
    // The first render sends 9; the server answers it kept 6 (audit finished).
    let fetcher = makeFetcher();
    const pool = {
      "qr-pool": {
        data: { id: "pool-1", title: "Sandbag" } as unknown as AssetFromQr,
        type: "asset" as const,
      },
    };
    refs.pendingPersistsRef.current.clear();

    const { rerender } = renderHook(() =>
      useAuditScanPersistence({
        auditSession,
        scannedItems: pool,
        expectedAssets: [],
        scanPersistFetcher: fetcher,
        ...refs,
        auditCounts: counts,
        onCountSaved,
      })
    );
    fetcher = makeFetcher({
      state: "idle",
      data: { success: true, foundQuantity: 6 },
    });
    rerender();

    expect(onCountSaved).toHaveBeenCalledWith("pool-1", 6, true);
    expect(refs.persistedItemsRef.current.has("pool-1")).toBe(true);
  });
});
