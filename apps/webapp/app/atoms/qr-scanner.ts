import type { BookingStatus } from "@prisma/client";
import { atom } from "jotai";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";

export type ScanListItems = {
  [key: string]: ScanListItem;
};

export type ScanListItem =
  | {
      data?: KitFromQr | AssetFromQr;
      error?: string;
      type?: "asset" | "kit";
      codeType?: "qr" | "barcode" | "samId"; // Track whether this came from QR, barcode, or SAM ID
    }
  | undefined;

/***********************
 * Scanned QR Id Atom  *
 *
 * The data is structured in a object where:
 * - key: qrId
 * - value: asset
 *
 ***********************/

export const scannedItemsAtom = atom<ScanListItems>({});

/**
 * A derived atom that extracts asset and kit IDs from the scanned items
 * This avoids repeatedly filtering the items in different components
 *
 * @returns An object containing arrays of assetIds and kitIds
 */
export const scannedItemIdsAtom = atom((get) => {
  const items = get(scannedItemsAtom);

  // Extract asset IDs from items of type "asset"
  const assetIds = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data?.id);

  // Extract kit IDs from items of type "kit"
  const kitIds = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data?.id);

  return { assetIds, kitIds, idsTotalCount: assetIds.length + kitIds.length };
});

/** Stores info about the last duplicate scan so consumers can show a toast / highlight. */
export type DuplicateScanInfo = {
  qrId: string;
  assetTitle: string;
  timestamp: number;
};
export const lastDuplicateScanAtom = atom<DuplicateScanInfo | null>(null);

// Add item to object with value `undefined` (just receives the key)
export const addScannedItemAtom = atom(
  null,
  (
    get,
    set,
    qrId: string,
    error?: string,
    codeType?: "qr" | "barcode" | "samId"
  ) => {
    const currentItems = get(scannedItemsAtom);
    if (!currentItems[qrId]) {
      /** Set can optionally receive error. If it does, add it to the item.
       * This is used for errors that are related to the QR code itself, not the item.
       */
      set(scannedItemsAtom, {
        [qrId]: error
          ? {
              error: error,
              codeType,
            }
          : {
              codeType,
            }, // Add the new entry at the start
        ...currentItems, // Spread the rest of the existing items
      });
    } else {
      // QR already in list – signal duplicate so consumers can show toast/highlight
      const existingItem = currentItems[qrId];
      if (existingItem?.data) {
        const title =
          "title" in existingItem.data
            ? (existingItem.data as AssetFromQr).title
            : (existingItem.data as KitFromQr).name;
        set(lastDuplicateScanAtom, {
          qrId,
          assetTitle: title || "Unknown",
          timestamp: Date.now(),
        });
      }
    }
  }
);

// Update item based on key
export const updateScannedItemAtom = atom(
  null,
  (get, set, { qrId, item }: { qrId: string; item: ScanListItem }) => {
    const currentItems = get(scannedItemsAtom);

    // Check if the item already exists with data; if it does, skip the update
    // Allow updates if the current item doesn't have data (just codeType or undefined)
    const currentItem = currentItems[qrId];
    if (!item || (currentItem && currentItem.data)) {
      return; // Skip the update if the item is already present with data
    }

    // Check for duplicate assets/kits by ID before adding
    if (item && item.data && item.type) {
      const assetOrKitId = item.data.id;

      // Look for existing items with the same asset/kit ID
      const existingDuplicateKey = Object.entries(currentItems).find(
        ([key, existingItem]) => {
          if (key === qrId) return false; // Don't compare with self
          return (
            existingItem?.data?.id === assetOrKitId &&
            existingItem?.type === item.type
          );
        }
      );

      if (existingDuplicateKey) {
        // Add the duplicate with an error message instead of blocking silently
        const duplicateItem: ScanListItem = {
          error: `This ${item.type} is already in the list.`,
          codeType: item.codeType,
        };

        set(scannedItemsAtom, {
          ...currentItems,
          [qrId]: duplicateItem,
        });
        return;
      }
    }

    if ((item && item?.data && item?.type) || item?.error) {
      set(scannedItemsAtom, {
        ...currentItems,
        [qrId]: item,
      });
    }
  }
);

// Remove item based on key
export const removeScannedItemAtom = atom(null, (get, set, qrId: string) => {
  const currentItems = get(scannedItemsAtom);
  const { [qrId]: _, ...rest } = currentItems; // Removes the key
  set(scannedItemsAtom, rest);
});

// Remove multiple items based on key array
export const removeMultipleScannedItemsAtom = atom(
  null,
  (get, set, qrIds: string[]) => {
    const currentItems = get(scannedItemsAtom);
    const updatedItems = { ...currentItems };
    qrIds.forEach((qrId) => {
      delete updatedItems[qrId];
    });
    set(scannedItemsAtom, updatedItems);
  }
);

// Remove items based on asset id
export const removeScannedItemsByAssetIdAtom = atom(
  null,
  (get, set, ids: string[]) => {
    const currentItems = get(scannedItemsAtom);
    const updatedItems = { ...currentItems };
    Object.entries(currentItems).forEach(([qrId, item]) => {
      if (item?.data?.id && ids.includes(item?.data?.id)) {
        delete updatedItems[qrId];
      }
    });
    set(scannedItemsAtom, updatedItems);
  }
);

// Clear all items
export const clearScannedItemsAtom = atom(null, (_get, set) => {
  set(scannedItemsAtom, {}); // Resets the atom to an empty object
});

/*******************************/

/* AUDIT-SPECIFIC ATOMS */

export type AuditSessionInfo = {
  id: string;
  name: string;
  targetId?: string | null;
  contextType?: string | null;
  contextName?: string | null;
  expectedAssetCount: number;
  foundAssetCount: number;
  missingAssetCount: number;
  unexpectedAssetCount: number;
} | null;

export type AuditAssetStatus = "found" | "missing" | "unexpected";

export type AuditScannedItem = {
  id: string;
  name: string;
  type: "asset" | "kit";
  auditStatus: AuditAssetStatus;
  expectedLocation?: string;
  currentLocation?: string;
  locationName?: string | null;
  auditAssetId?: string; // Link to AuditAsset record for notes/images
  auditNotesCount?: number;
  auditImagesCount?: number;
  mainImage?: string | null;
  thumbnailImage?: string | null;
};

export type AuditAssetMeta = {
  notesCount?: number;
  imagesCount?: number;
};

// Stores current audit session information
export const auditSessionAtom = atom<AuditSessionInfo>(null);

// Stores expected assets for the current audit target (location/kit)
export const auditExpectedAssetsAtom = atom<AuditScannedItem[]>([]);
// Local, client-side overrides for live note/image counts per audit asset.
export const auditAssetMetaAtom = atom<Record<string, AuditAssetMeta>>({});

// Derived atom that categorizes scanned items by audit status
export const auditResultsAtom = atom((get) => {
  const items = get(scannedItemsAtom);
  const expectedAssets = get(auditExpectedAssetsAtom);
  const sessionInfo = get(auditSessionAtom);

  if (!sessionInfo) {
    return {
      found: [] as AuditScannedItem[],
      missing: expectedAssets,
      unexpected: [] as AuditScannedItem[],
    };
  }

  // Create a map of expected asset IDs for quick lookup
  const expectedAssetIds = new Set(expectedAssets.map((asset) => asset.id));

  // Process scanned items
  const scannedAssets: AuditScannedItem[] = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => {
      const assetData = item!.data as AssetFromQr;
      return {
        id: assetData.id,
        name: assetData.title,
        type: "asset" as const,
        auditStatus: expectedAssetIds.has(assetData.id)
          ? ("found" as const)
          : ("unexpected" as const),
        locationName: assetData.location?.name ?? null,
      } satisfies AuditScannedItem;
    });

  // Categorize assets
  const found = scannedAssets.filter((asset) => asset.auditStatus === "found");
  const unexpected = scannedAssets.filter(
    (asset) => asset.auditStatus === "unexpected"
  );
  const foundIds = new Set(found.map((asset) => asset.id));
  const missing = expectedAssets.filter((asset) => !foundIds.has(asset.id));

  return {
    found,
    missing,
    unexpected,
  };
});

// Action atom to set expected assets for audit
export const setAuditExpectedAssetsAtom = atom(
  null,
  (_get, set, assets: AuditScannedItem[]) => {
    set(auditExpectedAssetsAtom, assets);
    // Seed meta counts from loader data so UI starts with server values.
    set(
      auditAssetMetaAtom,
      assets.reduce<Record<string, AuditAssetMeta>>((acc, asset) => {
        if (!asset.auditAssetId) return acc;
        acc[asset.auditAssetId] = {
          notesCount: asset.auditNotesCount ?? 0,
          imagesCount: asset.auditImagesCount ?? 0,
        };
        return acc;
      }, {})
    );
  }
);

export const incrementAuditAssetMetaAtom = atom(
  null,
  (
    get,
    set,
    {
      auditAssetId,
      notesDelta = 0,
      imagesDelta = 0,
    }: {
      auditAssetId: string;
      notesDelta?: number;
      imagesDelta?: number;
    }
  ) => {
    const current = get(auditAssetMetaAtom);
    const existing = current[auditAssetId] ?? {};
    // Keep counts in sync with local optimistic actions.
    const nextNotes = (existing.notesCount ?? 0) + notesDelta;
    const nextImages = (existing.imagesCount ?? 0) + imagesDelta;
    set(auditAssetMetaAtom, {
      ...current,
      [auditAssetId]: {
        ...existing,
        notesCount: Math.max(0, nextNotes),
        imagesCount: Math.max(0, nextImages),
      },
    });
  }
);

// Action atom to start an audit session
export const startAuditSessionAtom = atom(
  null,
  (_get, set, sessionInfo: Exclude<AuditSessionInfo, null>) => {
    set(auditSessionAtom, sessionInfo);
    // Clear any existing scanned items when starting a new audit
    set(scannedItemsAtom, {});
    set(auditAssetMetaAtom, {});
  }
);

// Action atom to end an audit session
export const endAuditSessionAtom = atom(null, (_get, set) => {
  set(auditSessionAtom, null);
  set(auditExpectedAssetsAtom, []);
  set(scannedItemsAtom, {});
  set(auditAssetMetaAtom, {});
});

/*******************************/

/* BOOKING PARTIAL-CHECKIN ATOMS */

/**
 * Booking-side "expected assets" — mirrors the audit expected-list
 * pattern so the partial-checkin drawer can render the full booking
 * contents upfront (scanned + pending + already-reconciled).
 *
 * Why a separate atom and not a generalized one? Audits and booking
 * check-in have divergent per-row metadata (audit: auditAssetId,
 * notes/images counts; booking: remaining, consumptionType) and
 * divergent derived states. Forcing one shared atom would require
 * every consumer to narrow by tag. Keeping them parallel preserves
 * the shared `scannedItemsAtom` substrate while giving each flow its
 * own expected-list shape.
 */

export type BookingExpectedAssetBase = {
  id: string;
  title: string;
  mainImage?: string | null;
  thumbnailImage?: string | null;
  /** When this asset belongs to a kit on the booking. */
  kitId?: string | null;
  kitName?: string | null;
};

export type BookingExpectedAsset =
  | (BookingExpectedAssetBase & {
      kind: "INDIVIDUAL";
      /** True if this asset appears in any PartialBookingCheckin.assetIds
       * for this booking (i.e. already reconciled by a prior session). */
      alreadyCheckedIn: boolean;
    })
  | (BookingExpectedAssetBase & {
      kind: "QUANTITY_TRACKED";
      /** BookingAsset.quantity — what was reserved. */
      booked: number;
      /** Σ of RETURN + CONSUME + LOSS + DAMAGE ConsumptionLog rows
       * for this (booking, asset) pair. */
      logged: number;
      /** `max(0, booked − logged)`. Remaining units to reconcile. */
      remaining: number;
      consumptionType: "ONE_WAY" | "TWO_WAY" | null;
    });

export type BookingCheckinSessionInfo = {
  bookingId: string;
  bookingName: string;
  status: BookingStatus;
  /** Total number of BookingAsset rows for this booking. Used by the
   * drawer's header/progress indicator. */
  expectedCount: number;
} | null;

/** Current booking check-in session metadata (similar to auditSessionAtom). */
export const bookingCheckinSessionAtom = atom<BookingCheckinSessionInfo>(null);

/** Expected assets for the current booking check-in session. */
export const bookingExpectedAssetsAtom = atom<BookingExpectedAsset[]>([]);

/** Replace the expected-assets list. Used by the init hook on mount. */
export const setBookingExpectedAssetsAtom = atom(
  null,
  (_get, set, assets: BookingExpectedAsset[]) => {
    set(bookingExpectedAssetsAtom, assets);
  }
);

/** Start a booking check-in session. Clears the scanned-items container
 * so prior sessions don't leak. */
export const startBookingCheckinSessionAtom = atom(
  null,
  (_get, set, info: Exclude<BookingCheckinSessionInfo, null>) => {
    set(bookingCheckinSessionAtom, info);
    set(scannedItemsAtom, {});
  }
);

/** End the session. Hook calls this on unmount. */
export const endBookingCheckinSessionAtom = atom(null, (_get, set) => {
  set(bookingCheckinSessionAtom, null);
  set(bookingExpectedAssetsAtom, []);
  set(scannedItemsAtom, {});
});

/**
 * Synthetic QR-key prefix for quick-checkin of QUANTITY_TRACKED assets.
 * Qty-tracked assets don't have physical barcodes, so operators can't
 * scan them. When the user clicks "Check in without scanning" on a
 * pending qty row, we insert an entry keyed by this prefix into
 * `scannedItemsAtom` — the rest of the drawer logic (removal,
 * disposition seeding, blockers) treats it identically to a real scan.
 *
 * Prefix is distinct enough to never collide with a real QR ID
 * (cuid-shaped).
 */
export const QUICK_CHECKIN_QR_PREFIX = "qty-checkin:";

/**
 * Inserts a synthetic scanned-item entry for a pending QTY_TRACKED
 * asset. The entry has pre-populated `data` so `GenericItemRow` skips
 * its API fetch (see the `shouldFetch` guard in generic-item-row.tsx).
 *
 * Idempotent: re-dispatching for the same asset is a no-op.
 */
export const quickCheckinQtyAssetAtom = atom(
  null,
  (
    get,
    set,
    asset: Extract<BookingExpectedAsset, { kind: "QUANTITY_TRACKED" }>
  ) => {
    const key = `${QUICK_CHECKIN_QR_PREFIX}${asset.id}`;
    const current = get(scannedItemsAtom);
    if (current[key]) return;
    set(scannedItemsAtom, {
      // New entry first — matches the ordering convention used by
      // `addScannedItemAtom` (newest scan appears at the top of the
      // drawer's scanned list).
      [key]: {
        type: "asset",
        codeType: "qr",
        /**
         * We cast through `unknown` because `AssetFromQr` is the full
         * Prisma `Asset.include({ location, custody })` payload, which
         * is vastly larger than what the drawer's `AssetRow` actually
         * reads (id, title, images, kitId, consumptionType,
         * unitOfMeasure). Synthesizing the whole shape would be
         * wasteful. The narrower downstream consumers don't touch the
         * missing fields; if a new consumer starts reading them, the
         * TS error on the cast site flags it.
         */
        data: {
          id: asset.id,
          title: asset.title,
          mainImage: asset.mainImage,
          thumbnailImage: asset.thumbnailImage,
          kitId: asset.kitId ?? null,
          consumptionType: asset.consumptionType,
          type: "QUANTITY_TRACKED",
        } as unknown as AssetFromQr,
      },
      ...current,
    });
  }
);

/*******************************/

/* BOOKING FULFIL-AND-CHECKOUT ATOMS */

/**
 * Phase 3d-Polish "Fulfil reservations & check out" flow atoms.
 *
 * These sit alongside the booking check-in session atoms above. The
 * check-in flow reconciles BookingAsset rows that already exist on a
 * booking; this flow resolves outstanding `BookingModelRequest`s (the
 * "N × AssetModel" reservations introduced in Phase 3d) by scanning
 * concrete assets to materialize them, then transitions RESERVED →
 * ONGOING in a single atomic submit.
 *
 * Why a separate parallel atom family (instead of generalising
 * `bookingCheckinSessionAtom`)? The two sessions have divergent data
 * models — check-in tracks per-asset `remaining` quantities on
 * existing BookingAssets, whereas fulfil tracks per-model `booked`
 * vs `remaining` counts on BookingModelRequests plus a read-only
 * "already included" list of concrete assets. Sharing a single atom
 * would force every consumer to discriminate by tag on every read.
 * Keeping them parallel preserves the shared `scannedItemsAtom`
 * substrate while each flow owns its own session shape.
 */

/**
 * One expected entry per outstanding `BookingModelRequest`. The
 * drawer renders `booked` synthetic pending rows per model and
 * decrements `remaining` as matching scans arrive.
 */
export type ExpectedModelRequest = {
  assetModelId: string;
  assetModelName: string;
  /** Original `BookingModelRequest.quantity` at session start. */
  booked: number;
  /** Units still pending in this session (client-side derived). */
  remaining: number;
};

/**
 * Fulfil-and-checkout session metadata. Null when no session is
 * active. `bookingFrom` is kept as ISO string because the atom layer
 * shouldn't own `Date` instances (they serialize poorly across
 * loader boundaries); consumers parse it when computing
 * `isBookingEarlyCheckout`.
 */
export type FulfilSessionInfo = {
  bookingId: string;
  bookingName: string;
  /** ISO string — drives `isBookingEarlyCheckout` in the submit path. */
  bookingFrom: string;
  expectedModelRequests: ExpectedModelRequest[];
  /**
   * Concrete BookingAssets already on the booking before this
   * session. Rendered in the drawer's "Already included" section as
   * a visual-only, non-interactive list so operators see the full
   * picture (mirrors the audit expected-list UX). Never mutated
   * client-side — the server owns these rows.
   */
  alreadyIncluded: Array<{
    id: string;
    title: string;
    mainImage: string | null;
    thumbnailImage: string | null;
    assetModelId: string | null;
    kitId: string | null;
    /**
     * `BookingAsset.quantity` on this booking — `1` for INDIVIDUAL
     * assets, `N` for QUANTITY_TRACKED. Lets the "Already included"
     * collapser render `"Pens × 20"` for qty-tracked rows instead
     * of hiding the unit count entirely.
     */
    bookedQuantity: number;
    /**
     * Asset type so the renderer knows whether to show the quantity
     * suffix (`QUANTITY_TRACKED`) or suppress it (`INDIVIDUAL`, which
     * is implicitly `× 1`).
     */
    type: "INDIVIDUAL" | "QUANTITY_TRACKED";
  }>;
} | null;

/** Current fulfil-and-checkout session metadata. */
export const fulfilSessionAtom = atom<FulfilSessionInfo>(null);

/**
 * Expected model-request list for the current session. Kept as a
 * separate atom (rather than reading through `fulfilSessionAtom`)
 * so per-scan derivations can subscribe without re-rendering on
 * every session-info change.
 */
export const expectedModelRequestsAtom = atom<ExpectedModelRequest[]>([]);

/**
 * Write-only: mount-time setter for the fulfil session.
 *
 * Mirrors `startBookingCheckinSessionAtom`. Writes both the session
 * metadata and the expected-model-requests list in one action, and
 * clears `scannedItemsAtom` so a prior session's scans (e.g. from
 * `scan-assets` or a previous fulfil attempt) don't leak into this
 * one. Called by the fulfil init hook on mount.
 */
export const setFulfilSessionAtom = atom(
  null,
  (_get, set, info: Exclude<FulfilSessionInfo, null>) => {
    set(fulfilSessionAtom, info);
    set(expectedModelRequestsAtom, info.expectedModelRequests);
    set(scannedItemsAtom, {});
  }
);

/**
 * Write-only: teardown for the fulfil session.
 *
 * Mirrors `endBookingCheckinSessionAtom`. Clears session info, the
 * expected list, and the shared scanned-items container. Called by
 * the fulfil init hook on unmount so returning to this flow later
 * starts from a clean slate.
 */
export const endFulfilSessionAtom = atom(null, (_get, set) => {
  set(fulfilSessionAtom, null);
  set(expectedModelRequestsAtom, []);
  set(scannedItemsAtom, {});
});
