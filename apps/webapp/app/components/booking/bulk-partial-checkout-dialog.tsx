/**
 * Bulk Partial Checkout Dialog
 *
 * Renders the "Check out selected items" dialog opened from the booking
 * overview bulk-actions dropdown. It mirrors `BulkPartialCheckinDialog`:
 * the user selects assets/kits in the booking list, opens this dialog, and
 * confirms checking out the still-Booked subset.
 *
 * The set of asset IDs submitted is the selected ASSETS (kits are excluded —
 * they only provide grouping) that are part of the booking and NOT already
 * checked out. "Already checked out" means the asset id is in the loader's
 * `checkedOutAssetIds` (per-booking partial-checkout records) OR the asset's
 * own `status === CHECKED_OUT`.
 *
 * If the submitted set equals ALL still-Booked assets in the booking, this is
 * a "final" checkout; combined with `isBookingEarlyCheckout(booking.from)` it
 * becomes an early checkout and we delegate to `CheckoutDialog` so the user
 * can choose whether to adjust the start date. Otherwise a plain
 * `partial-checkout` submit is used.
 *
 * @see {@link file://./bulk-partial-checkin-dialog.tsx} — the mirror source
 * @see {@link file://./checkout-dialog.tsx} — early-checkout confirmation
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx}
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetType } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { useActionData, useLoaderData } from "react-router";
import z from "zod";
import {
  clearSelectedBulkItemsAtom,
  selectedBulkItemsAtom,
} from "~/atoms/list";
import { useDisabled } from "~/hooks/use-disabled";
import { shouldPromptEarlyCheckout } from "~/modules/booking/helpers";
import type {
  BookingPageLoaderData,
  BookingPageActionData,
} from "~/routes/_layout+/bookings.$bookingId.overview";
import type { AssetWithStatus } from "~/utils/booking-assets";
import {
  flattenSelectedBookingItems,
  isAssetCheckableOut,
} from "~/utils/booking-assets";
import { tw } from "~/utils/tw";
import CheckoutDialog from "./checkout-dialog";
import { AssetImage } from "../assets/asset-image/component";
import { Form } from "../custom-form";
import KitImage from "../kits/kit-image";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

/**
 * Per-row checkout disposition for a single qty-tracked BookingAsset slice.
 * Mirrors the scanner drawer's `checkouts` payload so the server action can
 * accept either entrypoint with the same parser. `bookingAssetId` is required
 * because the same `assetId` may have multiple slices (standalone +
 * kit-driven) and the qty must be attributed to the exact slice.
 *
 * `quantity` arrives as a string from the form input and is coerced to a
 * positive integer (`min(1)`) so server-side validation rejects empty
 * submissions consistent with the singular check-out flow.
 */
export const checkoutDispositionSchema = z.object({
  assetId: z.string(),
  bookingAssetId: z.string(),
  quantity: z.coerce.number().int().min(1),
});

/**
 * JSON-encoded array of per-row qty-tracked checkout dispositions, supplied
 * alongside `assetIds[]` for INDIVIDUAL back-compat. Empty / missing string
 * coerces to `[]` so legacy (INDIVIDUAL-only) submissions remain valid.
 */
const checkoutsJsonField = z
  .string()
  .optional()
  .transform((raw) => {
    if (!raw) return [] as z.infer<typeof checkoutDispositionSchema>[];
    try {
      const parsed: unknown = JSON.parse(raw);
      return z.array(checkoutDispositionSchema).parse(parsed);
    } catch {
      return [] as z.infer<typeof checkoutDispositionSchema>[];
    }
  });

/**
 * Validation schema for the bulk partial checkout action. At least one asset
 * id must be supplied — the action rejects empty submissions.
 *
 * `checkouts` carries per-slice qty dispositions for QUANTITY_TRACKED assets
 * (JSON-encoded). INDIVIDUAL assets continue to flow through `assetIds[]`
 * for back-compat with the existing service entrypoint.
 */
export const BulkPartialCheckoutSchema = z.object({
  assetIds: z
    .array(z.string())
    .min(1, "Please select at least one asset to check out."),
  checkouts: checkoutsJsonField,
});

/**
 * Per-row qty picker for a single QUANTITY_TRACKED slice. Mirrors the
 * partial-check-IN drawer's `QuantityDispositionBlock` layout but collapses
 * to a single "Checked out" input — checkout has no Lost/Damaged/Consumed
 * split, just "how many units leave the pool now". The input clamps to
 * `[1..max]` via DOM attrs; the parent component additionally clamps the
 * serialized payload defensively.
 *
 * Hoisted to module scope so `flexRender`-style re-mount churn never
 * unmounts the input mid-edit (see `.claude/rules/react-render-stability.md`).
 *
 * @param props.bookingAssetId - Pivot slice id, used as the dispatch key
 * @param props.max - Booked qty for this slice (upper bound for the input)
 * @param props.value - Current input string (controlled)
 * @param props.onChange - Setter forwarded to the parent's state map
 */
function CheckoutQtyInput({
  bookingAssetId,
  max,
  value,
  onChange,
}: {
  bookingAssetId: string;
  max: number;
  value: string;
  onChange: (bookingAssetId: string, next: string) => void;
}) {
  return (
    <label className="ml-auto flex items-center gap-2">
      <span className="text-xs font-medium text-gray-700">Checked out</span>
      <input
        type="number"
        min={1}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(bookingAssetId, e.target.value)}
        inputMode="numeric"
        aria-label="Checkout quantity"
        className={tw(
          "w-14 rounded-md border border-gray-200 px-2 py-1 text-right text-sm tabular-nums text-gray-900",
          "focus:outline-none focus:ring-1 focus:ring-primary-500",
          "[appearance:textfield]",
          "[&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none",
          "[&::-webkit-outer-spin-button]:appearance-none"
        )}
      />
      <span className="text-xs tabular-nums text-gray-500">of {max}</span>
    </label>
  );
}

/**
 * Bulk partial checkout dialog.
 *
 * @param props.open - Whether the dialog is currently visible
 * @param props.setOpen - Setter to open/close the dialog
 */
// react-doctor:no-giant-component — deferred for follow-up refactor
export default function BulkPartialCheckoutDialog({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const disabled = useDisabled();
  const { booking, checkedOutAssetIds, remainingToCheckOutByAsset } =
    useLoaderData<BookingPageLoaderData>();

  const rawSelectedItems = useAtomValue(selectedBulkItemsAtom);

  // Denormalised asset list derived from the bookingAssets pivot — ONE entry
  // per `BookingAsset` slice (NOT deduped by asset id). A QUANTITY_TRACKED
  // asset can span multiple slices (standalone + kit-driven), and each slice
  // must survive so `flattenSelectedBookingItems` (which keys its enrichment
  // map by `bookingAssetId`) can enrich the exact selected slice. Deduping by
  // asset.id used to collapse the two slices, clobbering the standalone
  // slice's `kitId: null` with the kit slice's `kitId` → the row rendered in
  // neither bucket (the multi-slice checkout bug). This mirrors the check-in
  // dialog's un-deduped `assetsList`.
  //
  // We spread the pivot's per-row fields onto each entry — `bookingAssetId`,
  // `bookedQuantity`, plus the row-level `kit`/`kitId` resolved through the
  // BookingAsset's `assetKitId` — so the flattened selection downstream has
  // everything the qty picker and kit-grouping renderer need. Memoised so its
  // reference stays stable across renders while `booking.bookingAssets`
  // doesn't change — without this, the enriched-selection array would churn
  // → `qtySlices` would recompute → its consumer `useEffect` (which calls
  // `setQtyByBookingAssetId`) would fire on every render and trip React's
  // max-update-depth guard.
  const assetsList = useMemo<AssetWithStatus[]>(
    () =>
      booking.bookingAssets.map((ba) => {
        // Post-Phase-4a pivot: kit membership lives on `asset.assetKits[]`,
        // not on `asset.kit` directly. When the row was booked under a
        // specific kit slice, match it via `ba.assetKitId` so kit-driven
        // rows surface `{ kit, kitId }` and standalone rows leave both
        // null.
        const matchedAssetKit = ba.assetKitId
          ? ba.asset.assetKits?.find((ak) => ak.id === ba.assetKitId) ?? null
          : null;
        return {
          ...ba.asset,
          bookingAssetId: ba.id,
          // `?? 1` mirrors the overview loader's projection — defends
          // against partial fixtures (component tests sometimes omit
          // BookingAsset.quantity) so spreading this object doesn't
          // overwrite a caller-supplied bookedQuantity with `undefined`.
          bookedQuantity: ba.quantity ?? 1,
          kitId: matchedAssetKit?.kitId ?? null,
          kit: matchedAssetKit?.kit ?? null,
        };
      }),
    [booking.bookingAssets]
  );

  // Set of asset ids already checked out for THIS booking (partial-checkout
  // records). Asset `status === CHECKED_OUT` is checked separately by the
  // shared `isAssetCheckableOut` helper.
  const checkedOutIdsSet = useMemo(
    () => new Set(checkedOutAssetIds || []),
    [checkedOutAssetIds]
  );

  /**
   * Per-asset remaining-to-check-out lookup, sourced from the loader. For
   * QUANTITY_TRACKED assets this is `sum(bookedQuantity) - sum(checkedOutQuantity)`
   * across every slice the asset has on this booking. An asset is "fully
   * out" only when its value reaches 0; while > 0 the user can still top
   * off the remaining units via this dialog. Passed into the SHARED
   * `isAssetCheckableOut` predicate so the dropdown, this dialog, and any
   * future consumer all agree on top-off eligibility.
   */
  const remainingByAssetId = useMemo(
    () => remainingToCheckOutByAsset ?? {},
    [remainingToCheckOutByAsset]
  );

  // Flatten/enrich the selection via the SHARED resolver (single source of
  // truth with the dropdown and check-in dialog), then keep kits + the assets
  // that are still actionable. The QT-aware branch lives inside
  // `isAssetCheckableOut` via the `remainingByAssetId` option — collapsing
  // our previous inline branch into one helper.
  const flattenedItems = useMemo(
    () => flattenSelectedBookingItems(rawSelectedItems, assetsList),
    [rawSelectedItems, assetsList]
  );
  const selectedItems = useMemo(
    () =>
      flattenedItems.filter((item) => {
        if (item.type === "kit" || (item.name && item._count)) return true;
        return isAssetCheckableOut(item as AssetWithStatus, checkedOutIdsSet, {
          remainingByAssetId,
        });
      }),
    [flattenedItems, checkedOutIdsSet, remainingByAssetId]
  );

  /** Use state instead of ref so the component re-renders once the form
   * mounts — this guarantees portalContainer is the real DOM node
   * when the user opens the early-checkout dialog. */
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  // Determine whether this is a FINAL checkout: the assets being checked out
  // equal ALL still-Booked assets in the booking. Iterates the deduped
  // `assetsList` (post-pivot — `booking.assets` no longer exists) and runs
  // the same shared predicate as the selection filter so dropdown, dialog,
  // and final-checkout detection all agree, including QT top-off semantics.
  const remainingBookedAssets = assetsList.filter((asset) =>
    isAssetCheckableOut(asset as AssetWithStatus, checkedOutIdsSet, {
      remainingByAssetId,
    })
  );

  // Count only individual assets (exclude kit IDs), deduped, for final-checkout
  // detection and submission — the selection can contain the same asset twice
  // (e.g. scanned both standalone and as a kit member).
  const selectedAssetIds = Array.from(
    new Set(
      selectedItems
        .filter((item: any) => item.title && !item._count) // Only assets, not kits
        .map((asset: any) => asset.id)
    )
  );

  // Final checkout = the selected set IS exactly the still-Booked set. Use set
  // membership (not just count equality) so duplicates or an unrelated selection
  // of the same size can't be misread as "final".
  const remainingBookedAssetIds = new Set(
    remainingBookedAssets.map((asset) => asset.id)
  );
  const isFinalCheckout =
    selectedAssetIds.length > 0 &&
    selectedAssetIds.length === remainingBookedAssetIds.size &&
    selectedAssetIds.every((id) => remainingBookedAssetIds.has(id));

  // Early checkout is only relevant for final checkouts of a still-RESERVED
  // booking (checking out the whole remaining booking before the start date).
  // Once the booking is ONGOING/OVERDUE the start date is fixed and the date
  // choice is ignored server-side, so the prompt would be a confusing no-op.
  const isEarlyCheckout = Boolean(
    isFinalCheckout && shouldPromptEarlyCheckout(booking.status, booking.from)
  );

  function handleCloseDialog() {
    setOpen(false);
  }

  const [shouldClose, setShouldClose] = useState(false);

  const actionData = useActionData<BookingPageActionData>();

  // Clear the bulk selection once the action succeeds so the user does not need
  // to manually "unselect all" before selecting the next batch.
  const clearSelectedBulkItems = useSetAtom(clearSelectedBulkItemsAtom);

  // Tracks whether the latest submission came from THIS dialog. Both bulk
  // dialogs are always mounted and share useActionData, so without this guard
  // any successful overview action (e.g. saving notification recipients) would
  // close this dialog and clear the user's selection.
  const submittedRef = useRef(false);

  // First, detect a successful response, but only for a submission this dialog
  // initiated (submittedRef is set by the form's onSubmit below).
  useEffect(() => {
    if (!submittedRef.current) return;
    if (actionData && "success" in actionData && actionData.success) {
      setShouldClose(true);
    } else if (actionData) {
      // Our submission resolved without success (e.g. a validation error), so
      // stop tracking; a later unrelated success must not trigger close/clear.
      submittedRef.current = false;
    }
  }, [actionData]);

  // Then, close the dialog and clear the selection once revalidation completes.
  useEffect(() => {
    if (shouldClose && !disabled) {
      setOpen(false);
      setShouldClose(false); // Reset for future uses
      clearSelectedBulkItems();
      submittedRef.current = false;
    }
  }, [shouldClose, disabled, setOpen, clearSelectedBulkItems]);

  // No assets remain to check out — disable the submit affordance.
  const noAssetsToCheckOut = selectedAssetIds.length === 0;

  // Assets dropped from the selection because they are already (fully)
  // checked out. The QT helper still keeps tops-off rows in `selectedItems`,
  // so this only counts INDIVIDUAL assets that the predicate rejected and
  // QT rows with `remaining <= 0`. Sourced from `flattenedItems` so we
  // include every selected asset id once before the eligibility filter.
  const skippedCount =
    new Set(flattenedItems.filter((i) => i.title && !i._count).map((i) => i.id))
      .size - selectedAssetIds.length;

  /**
   * Narrow shape we read off each selected QUANTITY_TRACKED row when rendering
   * the qty picker. Pulled from `enrichedItems` in the overview loader (the
   * row data the selection atom holds): `bookingAssetId` keys the pivot
   * slice, `bookedQuantity` is the slice's booked units, `checkedOutQuantity`
   * is what the slice has already shipped. `type` discriminates
   * QUANTITY_TRACKED vs INDIVIDUAL (the latter falls back to the original
   * `assetIds[]` flow with no qty input).
   */
  type QtySliceFields = {
    id: string;
    bookingAssetId?: string;
    bookedQuantity?: number;
    checkedOutQuantity?: number;
    type?: AssetType;
  };

  /**
   * Collect every QUANTITY_TRACKED slice surviving the upstream filter and
   * compute a per-slice `remaining` (booked − already-checked-out). The same
   * `assetId` may have multiple slices in this list (standalone + kit-driven
   * multi-row), so after the naive per-row subtraction we walk slices in
   * stable order and cap the cumulative `remaining` for each `assetId` at
   * the loader's asset-level `remainingByAssetId[assetId]`. Without that
   * cap two rows could each advertise their own per-row remaining and
   * together over-claim at the asset level — the server clamps anyway but
   * the UI would be misleading. Slices with `remaining <= 0` are skipped
   * (already fully covered by prior checkouts).
   */
  const qtySlices = useMemo(() => {
    const slices: Array<{
      assetId: string;
      bookingAssetId: string;
      remaining: number;
    }> = [];
    // Track how much asset-level remaining we have left to distribute across
    // this asset's slices (greedy: fill earlier slices first).
    const assetRemainingLeft = new Map<string, number>();
    for (const item of selectedItems) {
      const row = item as QtySliceFields & {
        title?: string;
        _count?: unknown;
      };
      // Skip kit grouping rows — they have `_count` and no `title`.
      if (!row.title || row._count) continue;
      if (row.type !== AssetType.QUANTITY_TRACKED) continue;
      if (!row.bookingAssetId) continue;

      const booked = Math.max(0, row.bookedQuantity ?? 0);
      const checkedOut = Math.max(0, row.checkedOutQuantity ?? 0);
      const sliceRemaining = Math.max(0, booked - checkedOut);
      if (sliceRemaining <= 0) continue;

      // Cap the slice's remaining by what's still unallocated at the
      // asset level. Fall back to the per-slice value when the loader
      // didn't expose an entry for this asset (defensive — shouldn't
      // happen because the loader builds the map for every QT row).
      const assetCap =
        assetRemainingLeft.get(row.id) ??
        (row.id in remainingByAssetId
          ? Math.max(0, remainingByAssetId[row.id])
          : sliceRemaining);
      const allocated = Math.min(sliceRemaining, assetCap);
      if (allocated <= 0) continue;

      assetRemainingLeft.set(row.id, assetCap - allocated);
      slices.push({
        assetId: row.id,
        bookingAssetId: row.bookingAssetId,
        remaining: allocated,
      });
    }
    return slices;
  }, [selectedItems, remainingByAssetId]);

  /**
   * Per-slice qty input state, keyed by `bookingAssetId`. String values mirror
   * the underlying `<input type="number">` (empty allowed mid-edit) and are
   * coerced + validated by `checkoutDispositionSchema` server-side. Defaults
   * to the slice's `remaining` (booked − already-checked-out, capped by the
   * asset-level remaining) so the default tops off whatever is still
   * outstanding without over-committing.
   */
  const [qtyByBookingAssetId, setQtyByBookingAssetId] = useState<
    Record<string, string>
  >({});

  // Seed defaults whenever the slice set changes (dialog open, selection
  // change, revalidation). Only sets keys we don't already have a value
  // for — preserving in-progress edits across re-renders.
  useEffect(() => {
    setQtyByBookingAssetId((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const slice of qtySlices) {
        if (!(slice.bookingAssetId in next)) {
          // Seed to the remaining units this slice can still ship. The
          // upstream filter now KEEPS partially-checked-out QT assets, so
          // `remaining` (not raw `bookedQuantity`) is the correct cap.
          next[slice.bookingAssetId] = String(slice.remaining);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [qtySlices]);

  /**
   * Serialized payload for the hidden `checkouts` field. Mirrors the scanner
   * drawer's shape: `{ assetId, bookingAssetId, quantity }` per slice. Empty
   * / zero qty entries are dropped so the server only acts on positive
   * dispositions.
   */
  const checkoutsPayload = useMemo(
    () =>
      qtySlices
        .map((slice) => {
          const raw = qtyByBookingAssetId[slice.bookingAssetId] ?? "";
          const qty = Number(raw);
          if (!Number.isFinite(qty) || qty <= 0) return null;
          return {
            assetId: slice.assetId,
            bookingAssetId: slice.bookingAssetId,
            // Clamp to the slice's remaining units, not raw booked qty —
            // anything above `remaining` would over-claim against prior
            // checkouts (the server also clamps; this keeps the wire
            // payload honest).
            quantity: Math.min(qty, slice.remaining),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    [qtySlices, qtyByBookingAssetId]
  );

  /**
   * Quick lookup so the row JSX can decide whether to render a qty input.
   * Exposes the slice's `remaining` (not raw booked qty) so the input
   * `max` and the "of N" label both reflect what's still outstanding for
   * this slice after prior partial checkouts.
   */
  const qtySliceByBookingAssetId = useMemo(() => {
    const map = new Map<string, { remaining: number; assetId: string }>();
    for (const slice of qtySlices) {
      map.set(slice.bookingAssetId, {
        remaining: slice.remaining,
        assetId: slice.assetId,
      });
    }
    return map;
  }, [qtySlices]);

  /**
   * Stable per-row qty change handler. Passed to the hoisted `CheckoutQtyInput`
   * so each row update only touches its own key — preserves input identity
   * across re-renders even as the surrounding list reshuffles.
   */
  const handleQtyChange = (bookingAssetId: string, next: string) => {
    setQtyByBookingAssetId((prev) => ({ ...prev, [bookingAssetId]: next }));
  };

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={handleCloseDialog}
        className={tw("bulk-tagging-dialog lg:w-[400px]")}
        title={
          <div className="w-full">
            <div className={tw("mb-2")}>
              <h4>Check out selected items</h4>
              <p>
                The following items will be checked out and marked as Checked
                out.
              </p>
            </div>
          </div>
        }
      >
        <Form
          method="post"
          className="px-6 pb-6"
          ref={setFormElement}
          id="bulk-partial-checkout-form"
          onSubmit={() => {
            submittedRef.current = true;
          }}
        >
          <input type="hidden" name="returnJson" value="true" />

          {/* Only deduped asset IDs are sent to the backend (kits excluded). */}
          {selectedAssetIds.map((assetId: string, index: number) => (
            <input
              key={assetId}
              type="hidden"
              name={`assetIds[${index}]`}
              value={assetId}
            />
          ))}

          {/* Per-slice qty-tracked checkouts, JSON-encoded. Mirrors the
              scanner drawer's `checkouts` payload so the service can
              consume either entrypoint with one parser. INDIVIDUAL assets
              keep flowing through `assetIds[]` above for back-compat. */}
          <input
            type="hidden"
            name="checkouts"
            value={JSON.stringify(checkoutsPayload)}
          />

          {skippedCount > 0 && (
            <p className="mb-3 rounded border border-warning-200 bg-warning-50 p-2 text-xs text-warning-800">
              {skippedCount} selected item{skippedCount === 1 ? "" : "s"}{" "}
              {skippedCount === 1 ? "is" : "are"} already checked out and will
              be skipped.
            </p>
          )}

          {/* List of items being checked out */}
          <div className="mb-4 max-h-48 overflow-y-auto rounded border bg-gray-50 p-3">
            {(() => {
              // Separate kits and individual assets
              const kits = selectedItems.filter(
                (item: any) => item.name && item._count
              );
              const assets = selectedItems.filter(
                (item: any) => item.title && !item._count
              );
              const individualAssets = assets.filter(
                (asset: any) => !asset.kitId
              );

              // Group assets by kit and filter out kits with no assets to check out
              const kitGroups = kits
                .map((kit: any) => {
                  const kitAssets = assets.filter(
                    (asset: any) => asset.kitId === kit.id
                  );
                  return { kit, assets: kitAssets };
                })
                .filter(({ assets: kitAssets }) => kitAssets.length > 0);

              return (
                <div className="space-y-3">
                  {/* Kit groups */}
                  {kitGroups.map(({ kit, assets: kitAssets }) => (
                    <div key={kit.id}>
                      {/* Kit header */}
                      <div className="flex items-center gap-2">
                        <KitImage
                          kit={{
                            kitId: kit.id,
                            image: kit.mainImage,
                            imageExpiration: kit.mainImageExpiration,
                            alt: `${kit.name} kit image`,
                          }}
                          className="size-5"
                        />
                        <span className="text-sm font-medium">{kit.name}</span>
                        <span className="text-xs text-gray-500">
                          ({kitAssets.length} assets)
                        </span>
                        <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
                          KIT
                        </span>
                      </div>

                      {/* Kit assets */}
                      <ul className="ml-6 mt-2 space-y-1">
                        {kitAssets.map((asset: any) => {
                          // QUANTITY_TRACKED kit-asset rows get an inline qty
                          // picker. The bookingAssetId is the dispatch key —
                          // a single assetId can have multiple kit-driven
                          // slices in this list (Polish-6 multi-row).
                          const bookingAssetId: string | undefined =
                            asset.bookingAssetId;
                          const qtyInfo = bookingAssetId
                            ? qtySliceByBookingAssetId.get(bookingAssetId)
                            : undefined;
                          return (
                            <li
                              key={
                                bookingAssetId
                                  ? `${asset.id}-${bookingAssetId}`
                                  : asset.id
                              }
                              className="flex items-center gap-2 text-sm text-gray-700"
                            >
                              <AssetImage
                                className="size-5"
                                asset={{
                                  id: asset.id,
                                  thumbnailImage: asset.thumbnailImage,
                                  mainImage: asset.mainImage,
                                  mainImageExpiration:
                                    asset.mainImageExpiration,
                                }}
                                alt={`${asset.title} main image`}
                              />
                              <span className="font-medium">{asset.title}</span>
                              {asset.category && (
                                <span className="text-gray-500">
                                  {" "}
                                  ({asset.category.name})
                                </span>
                              )}
                              {qtyInfo && bookingAssetId ? (
                                <CheckoutQtyInput
                                  bookingAssetId={bookingAssetId}
                                  max={qtyInfo.remaining}
                                  value={
                                    qtyByBookingAssetId[bookingAssetId] ?? ""
                                  }
                                  onChange={handleQtyChange}
                                />
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}

                  {/* Individual assets (not part of kits) */}
                  {individualAssets.length > 0 && (
                    <ul className="space-y-1">
                      {individualAssets.map((asset: any) => {
                        // Render a qty input only for QUANTITY_TRACKED
                        // standalone slices. INDIVIDUAL rows render exactly
                        // as before — they're served by the `assetIds[]`
                        // back-compat path with implicit qty = 1.
                        const bookingAssetId: string | undefined =
                          asset.bookingAssetId;
                        const qtyInfo = bookingAssetId
                          ? qtySliceByBookingAssetId.get(bookingAssetId)
                          : undefined;
                        return (
                          <li
                            key={
                              bookingAssetId
                                ? `${asset.id}-${bookingAssetId}`
                                : asset.id
                            }
                            className="flex items-center gap-2 text-sm text-gray-700"
                          >
                            <AssetImage
                              className="size-5"
                              asset={{
                                id: asset.id,
                                thumbnailImage: asset.thumbnailImage,
                                mainImage: asset.mainImage,
                                mainImageExpiration: asset.mainImageExpiration,
                              }}
                              alt={`${asset.title} main image`}
                            />
                            <span className="font-medium">{asset.title}</span>
                            {asset.category && (
                              <span className="text-gray-500">
                                {" "}
                                ({asset.category.name})
                              </span>
                            )}
                            {qtyInfo && bookingAssetId ? (
                              <CheckoutQtyInput
                                bookingAssetId={bookingAssetId}
                                max={qtyInfo.remaining}
                                value={
                                  qtyByBookingAssetId[bookingAssetId] ?? ""
                                }
                                onChange={handleQtyChange}
                              />
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })()}
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>

            {/* Submit button - conditional based on early check-out. The
                CheckoutDialog submits this same form (carrying the hidden
                assetIds + returnJson). We pass intent="partial-checkout" so the
                overview action routes to checkoutAssets/partialCheckoutBooking
                (which records the batch + applies the date choice) rather than
                the whole-booking checkoutBooking that the default intent would
                trigger on this intent-routed page. */}
            {isEarlyCheckout ? (
              <CheckoutDialog
                booking={{
                  id: booking.id,
                  name: booking.name,
                  from: booking.from,
                }}
                intent="partial-checkout"
                disabled={disabled || noAssetsToCheckOut}
                portalContainer={formElement || undefined}
                formId="bulk-partial-checkout-form"
                fullWidth
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                width="full"
                disabled={disabled || noAssetsToCheckOut}
                name="intent"
                value="partial-checkout"
                className="whitespace-nowrap"
              >
                Check out items
              </Button>
            )}
          </div>
        </Form>
      </Dialog>
    </DialogPortal>
  );
}
