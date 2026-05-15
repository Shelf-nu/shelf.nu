/**
 * Fulfil Reservations & Check Out Drawer
 *
 * Drawer UI for the "Fulfil reservations & check out" scanner flow on
 * a RESERVED booking that still has `BookingModelRequest` rows with
 * `quantity > 0`. Collapses the previous three-step workflow (Scan
 * assets → navigate back → Check out) into one purposeful flow by
 * showing the operator _what's expected_ up-front as pre-rendered
 * pending rows grouped by `AssetModel`, with per-model progress
 * strips.
 *
 * Buckets (top-to-bottom, per plan §C):
 *
 *   1. Pending model rows       — `booked - matched` synthetic rows
 *                                  per expected model, gray "Pending"
 *                                  badge, no actions.
 *   2. Matched scanned rows     — QR scans whose resolved asset's
 *                                  `assetModelId` matches an expected
 *                                  model and whose session count is
 *                                  within `booked`. Green "Ready".
 *   3. Unmatched scanned rows   — off-model scans OR over-scans of an
 *                                  expected model. Yellow warning
 *                                  badge clarifying the asset will
 *                                  both land on the booking _and_ go
 *                                  with this checkout.
 *   4. Already included         — concrete `BookingAsset`s already on
 *                                  the booking. Collapsed by default,
 *                                  green "Already included" chip,
 *                                  read-only.
 *
 * The submit button integrates the existing `CheckoutDialog` so the
 * early-checkout alert flow stays byte-identical with the non-fulfil
 * checkout path. When any expected model still has pending rows
 * (`matched < booked`), the submit button is disabled with copy
 * `"Scan N more units to continue"`.
 *
 * This component **only reads atoms** — the fulfil session is seeded
 * by the parent route via `useBookingFulfilSessionInitialization`
 * (Track T4). The drawer renders nothing when the session atom is
 * null (transient unmount state).
 *
 * @see {@link file:///home/donkoko/.claude/plans/phase-3d-fulfil-and-checkout.md}
 *   — §C (drawer render) and §D (scan validation) spec.
 * @see {@link file://./../../../atoms/qr-scanner.ts} — `fulfilSessionAtom`,
 *   `expectedModelRequestsAtom`, `scannedItemsAtom`.
 * @see {@link file://./../../../hooks/use-booking-fulfil-session-initialization.ts}
 *   — mount hook (called from the route, not here).
 * @see {@link file://./partial-checkin-drawer.tsx} — bucket/synthetic-row
 *   pattern being mirrored.
 * @see {@link file://./../../../booking/checkout-dialog.tsx} — dialog
 *   reused verbatim for the early-checkout alert flow.
 */

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronDownIcon, Package as PackageIcon } from "lucide-react";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  expectedModelRequestsAtom,
  fulfilSessionAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  type FulfilSessionInfo,
} from "~/atoms/qr-scanner";
import CheckoutDialog, {
  CheckoutIntentEnum,
} from "~/components/booking/checkout-dialog";
import { Form } from "~/components/custom-form";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Progress } from "~/components/shared/progress";
import type { AssetFromQr } from "~/routes/api+/get-scanned-item.$qrId";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { tw } from "~/utils/tw";
import ConfigurableDrawer from "../configurable-drawer";
import { DefaultLoadingState, GenericItemRow, Tr } from "../generic-item-row";

/**
 * Zod schema for the fulfil-and-checkout form payload.
 *
 * - `assetIds`: union of matched + unmatched scanned asset ids. The
 *   server will materialize outstanding `BookingModelRequest` rows
 *   against matching assets and add any off-model assets as new
 *   `BookingAsset` rows in the same transaction.
 * - `kitIds`: reserved for future kit-level fulfilment. Currently
 *   always empty — kit fulfilment is out of scope for Phase 3d-Polish
 *   (see plan §G).
 * - `checkoutIntentChoice`: populated only by the `CheckoutDialog`
 *   early-checkout alert buttons. Undefined on the plain submit path
 *   (not-early) — the server treats undefined as "keep original
 *   `from`".
 *
 * Exported so the route action (Track T3) can import and reuse it.
 */
export const fulfilAndCheckoutSchema = z.object({
  assetIds: z.array(z.string()),
  kitIds: z.array(z.string()).optional().default([]),
  checkoutIntentChoice: z.nativeEnum(CheckoutIntentEnum).optional(),
});

/** Shared pill class for the little type badge next to titles. */
const assetTypePillClass = tw(
  "inline-block bg-gray-50 px-[6px] py-[2px]",
  "rounded-md border border-gray-200",
  "text-xs text-gray-700"
);

/**
 * Shape of a scanned asset row after bucket classification. `qrId`
 * preserves the insertion order from `scannedItemsAtom` so the drawer
 * feels stable as scans arrive.
 */
type ScannedAssetRow = {
  qrId: string;
  /** Real `AssetFromQr` payload when resolved, undefined while loading. */
  asset: AssetFromQr | undefined;
  /**
   * - `"matched"`    — fills a pending model row (counts toward progress)
   * - `"unmatched"`  — off-model OR over-scan OR still loading (warning copy)
   * - `"duplicate"`  — asset is already on the booking via `alreadyIncluded`
   *                    (pre-fulfilled); the scan is a no-op and must not be
   *                    submitted, otherwise the server would fail on the
   *                    BookingAsset unique constraint.
   */
  bucket: "matched" | "unmatched" | "duplicate";
};

/**
 * Props for {@link FulfilReservationsDrawer}.
 */
type FulfilReservationsDrawerProps = {
  /** Forwarded through to `ConfigurableDrawer` / `BaseDrawer`. */
  className?: string;
  /** Forwarded through to `ConfigurableDrawer` / `BaseDrawer`. */
  style?: CSSProperties;
  /** `true` while a submit is in-flight — disables the submit button. */
  isLoading?: boolean;
  /** Forwarded through to `ConfigurableDrawer`. */
  defaultExpanded?: boolean;
};

/**
 * Drawer component for the fulfil-and-checkout scanner flow.
 *
 * Reads `fulfilSessionAtom`, `expectedModelRequestsAtom`, and
 * `scannedItemsAtom` from Jotai. The fulfil session is seeded by the
 * parent route via the init hook; the drawer is purely presentational
 * and dispatch-free (aside from trash/clear actions on scanned items).
 *
 * When the session atom is null (transient unmount state) the drawer
 * renders nothing — the parent route controls mounting once loader
 * data lands.
 *
 * @param props - See {@link FulfilReservationsDrawerProps}.
 */
export default function FulfilReservationsDrawer({
  className,
  style,
  isLoading,
  defaultExpanded = false,
}: FulfilReservationsDrawerProps) {
  const session = useAtomValue(fulfilSessionAtom);
  const expectedModelRequests = useAtomValue(expectedModelRequestsAtom);
  const items = useAtomValue(scannedItemsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);

  /**
   * Classify scanned items into matched / unmatched buckets using the
   * row-matching algorithm from plan §C. The matched-count tally is
   * derived per-render (not stored in state) so a scan can flip
   * buckets as the upstream model list changes.
   *
   * Assets that haven't resolved yet (`asset === undefined`) flow
   * through `GenericItemRow`'s loading branch. We still classify them
   * — parking them in "unmatched" is safe: once the fetch resolves,
   * this memo re-runs and the row migrates to "matched" if a slot is
   * free.
   */
  const alreadyIncludedIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of session?.alreadyIncluded ?? []) {
      set.add(item.id);
    }
    return set;
  }, [session?.alreadyIncluded]);

  const scannedBuckets = useMemo(() => {
    // assetModelId → number of scans consumed against that model's
    // `remaining` quota so far in this iteration. "Remaining" already
    // accounts for pre-fulfilled units — a model with `quantity: 3,
    // fulfilledQuantity: 2` ships `remaining: 1`, so only one scan can
    // match before we flip to "unmatched" (over-scan).
    const matchedCountByModel = new Map<string, number>();
    const rows: ScannedAssetRow[] = [];

    for (const [qrId, item] of Object.entries(items)) {
      if (!item) continue;
      // Only assets participate in model-request matching. Kits
      // aren't supported in this flow (plan §G: out of scope) — the
      // route loader filters them out of the expected list. Skip
      // defensively without adding them to `rows`.
      if (item.type && item.type !== "asset") continue;

      const asset = (item.data ?? undefined) as AssetFromQr | undefined;

      // Duplicate detection: if the scanned asset is already on the
      // booking (pre-fulfilled, sitting in `alreadyIncluded`), the
      // scan must NOT count as a fresh match. Otherwise the operator
      // can fake-complete the progress bar by re-scanning the same
      // asset, and the submit would blow up on the BookingAsset
      // `@@unique([bookingId, assetId])` constraint.
      if (asset && alreadyIncludedIds.has(asset.id)) {
        rows.push({ qrId, asset, bucket: "duplicate" });
        continue;
      }

      const modelId = asset?.assetModelId ?? null;
      const expected = modelId
        ? expectedModelRequests.find((e) => e.assetModelId === modelId)
        : undefined;

      if (expected) {
        const consumed = matchedCountByModel.get(expected.assetModelId) ?? 0;
        // Only scans within the STILL-OUTSTANDING count match. If the
        // request is already partially pre-fulfilled (2 of 3 scanned
        // earlier), only one more scan can match; subsequent scans
        // flip to unmatched/over-scan.
        if (consumed < expected.remaining) {
          matchedCountByModel.set(expected.assetModelId, consumed + 1);
          rows.push({ qrId, asset, bucket: "matched" });
          continue;
        }
      }

      // Either (a) the asset resolved but its model isn't expected,
      // (b) it's an over-scan of an expected model, or (c) the asset
      // hasn't resolved yet. In all cases we park it in "unmatched"
      // so `GenericItemRow` still mounts + fires the fetch.
      rows.push({ qrId, asset, bucket: "unmatched" });
    }

    return { rows, matchedCountByModel };
  }, [items, expectedModelRequests, alreadyIncludedIds]);

  /**
   * Per-model progress strips (`Dell 2/3 • HP 0/1`). The progress
   * numerator counts pre-fulfilled units (materialised in previous
   * sessions) PLUS the in-session matched scans — operators see
   * cumulative fulfilment against the original reservation, which
   * matches their mental model ("I reserved 3, I've got 2 already,
   * I need 1 more").
   *
   * - `booked`   = original `BookingModelRequest.quantity` (denominator)
   * - `prefulfilled` = `booked - remaining` (units already materialised
   *                     before this scanner opened)
   * - `matched`  = in-session scans that correctly matched this model
   */
  const progressByModel = useMemo(
    () =>
      expectedModelRequests.map((expected) => {
        const prefulfilled = Math.max(0, expected.booked - expected.remaining);
        const matched =
          scannedBuckets.matchedCountByModel.get(expected.assetModelId) ?? 0;
        return {
          assetModelId: expected.assetModelId,
          assetModelName: expected.assetModelName,
          booked: expected.booked,
          remaining: expected.remaining,
          prefulfilled,
          matched,
        };
      }),
    [expectedModelRequests, scannedBuckets.matchedCountByModel]
  );

  /**
   * Total units still expected across all models. Drives the submit
   * button's disabled state + copy (per plan §C: "Scan N more units
   * to continue"). Uses `remaining` (outstanding units) not `booked`
   * so pre-fulfilled units don't count as "still needed".
   */
  const pendingUnitCount = useMemo(
    () =>
      progressByModel.reduce(
        (sum, model) => sum + Math.max(0, model.remaining - model.matched),
        0
      ),
    [progressByModel]
  );

  /**
   * List of asset ids (matched + unmatched, resolved only) to submit.
   * Unresolved scans are excluded — submitting them would blow up
   * server-side since we don't yet know what they point to. Operators
   * see the loading state and can submit again once resolved.
   * Duplicate-bucket rows are ALSO excluded — those assets are
   * already on the booking, submitting their id would trip the
   * BookingAsset unique constraint.
   */
  const assetIdsToSubmit = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of scannedBuckets.rows) {
      if (row.bucket === "duplicate") continue;
      const id = row.asset?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }, [scannedBuckets.rows]);

  /**
   * Synthetic pending rows: one per outstanding unit per model. Built
   * after all hooks so the hook-count is stable across renders; safe
   * because it reads only memoized values above.
   */
  const pendingModelRows = useMemo(() => {
    const rows: Array<{
      key: string;
      assetModelId: string;
      assetModelName: string;
      indexInModel: number;
    }> = [];
    for (const model of progressByModel) {
      // Pending rows = outstanding (remaining) minus in-session scans.
      // Do NOT use `booked` here — that would render pending rows for
      // units that were already materialised in previous scans and are
      // now sitting as concrete BookingAssets in "Already included".
      const pending = Math.max(0, model.remaining - model.matched);
      for (let i = 0; i < pending; i += 1) {
        rows.push({
          key: `pending-${model.assetModelId}-${i}`,
          assetModelId: model.assetModelId,
          assetModelName: model.assetModelName,
          indexInModel: i,
        });
      }
    }
    return rows;
  }, [progressByModel]);

  // Early return AFTER all hooks so the hook order stays stable
  // across renders (React rules of hooks). The session only turns
  // null during a transient unmount window — the init hook's cleanup
  // runs as the drawer tears down.
  if (!session) {
    return null;
  }

  /**
   * Header rendered above the item list. Shows the booking name and
   * per-model progress strips. Lives in `ConfigurableDrawer`'s
   * `headerContent` slot so it stays pinned while the row body
   * scrolls underneath.
   */
  const headerContent = (
    <FulfilHeader session={session} progressByModel={progressByModel} />
  );

  /** Render a single scanned item row (matched or unmatched). */
  const renderScannedItemRow = (row: ScannedAssetRow): ReactNode => (
    <GenericItemRow
      key={row.qrId}
      qrId={row.qrId}
      item={items[row.qrId]}
      onRemove={removeItem}
      renderLoading={(pendingQrId, error) => (
        <DefaultLoadingState qrId={pendingQrId} error={error} />
      )}
      renderItem={(data) => (
        <ScannedAssetRowBody asset={data as AssetFromQr} bucket={row.bucket} />
      )}
    />
  );

  /**
   * Custom renderer that interleaves the buckets top-to-bottom
   * (pending → matched → duplicate → unmatched → already-included).
   * Duplicates sit ABOVE unmatched so the operator sees the blocker
   * (red "Already on this booking") before the softer yellow warning.
   */
  const customRenderAllItems = (): ReactNode => {
    const matched = scannedBuckets.rows.filter((r) => r.bucket === "matched");
    const duplicate = scannedBuckets.rows.filter(
      (r) => r.bucket === "duplicate"
    );
    const unmatched = scannedBuckets.rows.filter(
      (r) => r.bucket === "unmatched"
    );

    return (
      <>
        {/* Bucket 1: pending synthetic rows (gray "Pending" badge). */}
        {pendingModelRows.map((row) => (
          <PendingModelRow key={row.key} assetModelName={row.assetModelName} />
        ))}

        {/* Bucket 2: matched scanned rows (green "Ready" chip). */}
        {matched.map(renderScannedItemRow)}

        {/* Bucket 3: duplicate scanned rows (red "Already on this
            booking" blocker). Rendered above the yellow warnings so
            the operator clears the blocker first. */}
        {duplicate.map(renderScannedItemRow)}

        {/* Bucket 4: unmatched scanned rows (yellow warning badge). */}
        {unmatched.map(renderScannedItemRow)}

        {/* Bucket 5: already-included collapser (collapsed by default). */}
        {session.alreadyIncluded.length > 0 ? (
          <AlreadyIncludedCollapser assets={session.alreadyIncluded} />
        ) : null}
      </>
    );
  };

  const shouldDisableSubmit = Boolean(isLoading) || pendingUnitCount > 0;
  const disabledReason =
    pendingUnitCount > 0
      ? `Scan ${pendingUnitCount} more unit${
          pendingUnitCount === 1 ? "" : "s"
        } to continue`
      : null;

  return (
    <ConfigurableDrawer
      schema={fulfilAndCheckoutSchema}
      items={items}
      onClearItems={clearList}
      title="Fulfil reservations & check out"
      isLoading={isLoading}
      customRenderAllItems={customRenderAllItems}
      // Render body even when nothing has been scanned yet — pending
      // rows still need to be visible so the operator knows what's
      // expected.
      renderWhenEmpty
      defaultExpanded={defaultExpanded}
      className={tw(
        "[&_.default-base-drawer-header]:rounded-b [&_.default-base-drawer-header]:border [&_.default-base-drawer-header]:px-4 [&_thead]:hidden",
        className
      )}
      style={style}
      headerContent={headerContent}
      form={
        <FulfilCheckoutForm
          booking={{
            id: session.bookingId,
            name: session.bookingName,
            from: new Date(session.bookingFrom),
          }}
          assetIds={assetIdsToSubmit}
          isLoading={isLoading}
          disableSubmit={shouldDisableSubmit}
          disabledReason={disabledReason}
        />
      }
    />
  );
}

/**
 * Drawer header: booking name + per-model progress strips.
 *
 * Rendered as the drawer's `headerContent` so it stays pinned while
 * the scanned/pending list scrolls underneath.
 */
function FulfilHeader({
  session,
  progressByModel,
}: {
  session: Exclude<FulfilSessionInfo, null>;
  progressByModel: Array<{
    assetModelId: string;
    assetModelName: string;
    booked: number;
    remaining: number;
    prefulfilled: number;
    matched: number;
  }>;
}) {
  return (
    <div className="border border-b-0 bg-gray-50 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Button
              to={`/bookings/${session.bookingId}`}
              variant="link"
              className="text-left font-medium text-gray-900 hover:text-gray-700"
            >
              {session.bookingName}
            </Button>
            <p className="text-xs text-gray-600">
              Scan reserved models to fulfil this booking. Off-model scans are
              accepted with a warning.
            </p>
          </div>
        </div>

        {progressByModel.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {progressByModel.map((model) => {
              // Cumulative fulfilment against the ORIGINAL reservation
              // — includes units scanned in previous sessions
              // (`prefulfilled`) so the operator's mental model
              // ("I reserved 3, I've got 2 already") stays consistent
              // on re-entry.
              const fulfilled = model.prefulfilled + model.matched;
              const percentage =
                model.booked > 0
                  ? Math.min(100, (fulfilled / model.booked) * 100)
                  : 0;
              return (
                <li
                  key={model.assetModelId}
                  className="flex items-center gap-3"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                    {model.assetModelName}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-600">
                    {fulfilled} / {model.booked}
                  </span>
                  <Progress
                    aria-label={`${model.assetModelName}: ${fulfilled} of ${model.booked} fulfilled`}
                    value={percentage}
                    className="h-1.5 w-32 shrink-0"
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Synthetic pending row — one per still-outstanding unit on an
 * expected model. Shows a `Package` icon placeholder in place of an
 * asset thumbnail (no concrete asset to render yet) and a gray
 * "Pending" badge. Not interactive — the operator resolves these by
 * scanning a matching QR.
 */
function PendingModelRow({ assetModelName }: { assetModelName: string }) {
  return (
    <Tr skipEntrance>
      <td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          <div className="flex items-center gap-2">
            <div
              aria-hidden="true"
              className="flex size-[54px] shrink-0 items-center justify-center rounded-[2px] border border-gray-200 bg-gray-50"
            >
              <PackageIcon className="size-6 text-gray-400" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="word-break whitespace-break-spaces font-medium text-gray-800">
                {assetModelName}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <span className={assetTypePillClass}>model</span>
                <Badge
                  color={BADGE_COLORS.gray.bg}
                  textColor={BADGE_COLORS.gray.text}
                  withDot={false}
                >
                  Pending
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </td>
      <td>
        {/* No remove button — pending rows aren't interactive. */}
        <div className="w-[52px]" />
      </td>
    </Tr>
  );
}

/**
 * Body of a scanned-asset row (rendered inside `GenericItemRow`'s
 * `renderItem` slot). Branches on `bucket` for the status chip:
 *
 * - `"matched"`   → green "Ready" chip.
 * - `"unmatched"` → yellow warning badge. Copy explicitly states the
 *   asset will land on the booking _and_ go with this checkout so
 *   the operator knows both side-effects are coupled into one submit
 *   (plan §C-c requires the warning to be crystal clear about both).
 * - `"duplicate"` → rose warning badge. The asset is already on the
 *   booking (pre-fulfilled); the scan is a no-op and will be dropped
 *   from the submit payload, so the operator knows to scan a
 *   different unit.
 */
function ScannedAssetRowBody({
  asset,
  bucket,
}: {
  asset: AssetFromQr;
  bucket: "matched" | "unmatched" | "duplicate";
}) {
  return (
    <div className="flex items-center gap-2">
      <ImageWithPreview
        thumbnailUrl={asset.thumbnailImage || asset.mainImage}
        alt={asset.title || "Asset"}
        className="size-[54px] rounded-[2px]"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="word-break whitespace-break-spaces font-medium text-gray-800">
          {asset.title}
        </span>
        <div className="flex flex-wrap items-center gap-1">
          <span className={assetTypePillClass}>asset</span>
          {bucket === "matched" ? (
            <Badge
              color={BADGE_COLORS.green.bg}
              textColor={BADGE_COLORS.green.text}
              withDot={false}
            >
              Ready
            </Badge>
          ) : bucket === "duplicate" ? (
            <Badge
              color={BADGE_COLORS.red.bg}
              textColor={BADGE_COLORS.red.text}
              withDot={false}
              className="max-w-full"
            >
              Already on this booking — remove this scan
            </Badge>
          ) : (
            <Badge
              color={BADGE_COLORS.amber.bg}
              textColor={BADGE_COLORS.amber.text}
              withDot={false}
              className="max-w-full"
            >
              Will be added to booking and checked out
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Collapser wrapping the "Already included" section — concrete
 * `BookingAsset`s that were on the booking before this session
 * started. Closed by default because the operator usually only cares
 * about what's still outstanding, but expandable so they can confirm
 * the full picture matches their expectation.
 *
 * Read-only: no remove button, no inputs. The server owns these rows;
 * this scanner flow only _adds_ new ones.
 */
function AlreadyIncludedCollapser({
  assets,
}: {
  assets: Exclude<FulfilSessionInfo, null>["alreadyIncluded"];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tr skipEntrance>
        <td
          colSpan={2}
          className="bg-gray-50 px-4 py-2 text-xs font-medium text-gray-600"
        >
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="flex w-full items-center gap-2"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={tw(
                "size-4 shrink-0 text-gray-500 transition-transform duration-150",
                open ? "rotate-0" : "-rotate-90"
              )}
            />
            <span>Already included ({assets.length})</span>
          </button>
        </td>
      </Tr>
      {open
        ? assets.map((asset) => (
            <Tr key={`already-included-${asset.id}`} skipEntrance>
              <td className="w-full p-0 md:p-0">
                <div className="flex items-center justify-between gap-3 p-4 md:px-6">
                  <div className="flex items-center gap-2">
                    <ImageWithPreview
                      thumbnailUrl={asset.thumbnailImage || asset.mainImage}
                      alt={asset.title || "Asset"}
                      className="size-[54px] rounded-[2px]"
                    />
                    <div className="flex flex-col gap-1">
                      <span className="word-break whitespace-break-spaces font-medium text-gray-800">
                        {asset.title}
                        {/* QUANTITY_TRACKED assets are booked as an
                            aggregate count (e.g. "Pens × 20"). Without
                            the suffix the operator can't tell a row
                            representing 20 pens from one representing
                            1 pen. INDIVIDUAL assets always carry
                            `quantity: 1` so we suppress the suffix for
                            them to avoid `× 1` noise. */}
                        {asset.type === "QUANTITY_TRACKED" ? (
                          <span className="ml-1.5 text-xs font-medium text-gray-500">
                            &times; {asset.bookedQuantity}
                          </span>
                        ) : null}
                      </span>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={assetTypePillClass}>asset</span>
                        <Badge
                          color={BADGE_COLORS.green.bg}
                          textColor={BADGE_COLORS.green.text}
                          withDot={false}
                        >
                          Already included
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              </td>
              <td>
                <div className="w-[52px]" />
              </td>
            </Tr>
          ))
        : null}
    </>
  );
}

/**
 * Props for {@link FulfilCheckoutForm}.
 */
type FulfilCheckoutFormProps = {
  /** Booking summary for `CheckoutDialog`'s early-checkout detection. */
  booking: { id: string; name: string; from: Date };
  /** Matched + unmatched scanned asset ids to attach to the booking. */
  assetIds: string[];
  /** `true` while a submit is in-flight. */
  isLoading?: boolean;
  /** `true` when any expected model has pending rows or `isLoading`. */
  disableSubmit: boolean;
  /**
   * Human-readable copy explaining why the submit is disabled, or
   * `null` when enabled. Rendered above the submit button.
   */
  disabledReason: string | null;
};

/**
 * Form rendered in the drawer footer.
 *
 * Mirrors the partial-checkin drawer's `CustomForm`: the drawer owns
 * the `<form>` element so `CheckoutDialog`'s alert-dialog buttons can
 * submit via `form={formId}` portal attributes, keeping the alert
 * copy byte-identical with the non-fulfil checkout path.
 *
 * Two submit paths, both handled by `CheckoutDialog` itself:
 *
 * 1. Early-checkout booking (`isBookingEarlyCheckout`) → dialog
 *    trigger opens the alert. Its two submit buttons ship
 *    `checkoutIntentChoice="with-adjusted-date"` or
 *    `"without-adjusted-date"` via `name`/`value` on the buttons.
 * 2. On-time booking → plain submit button, no `checkoutIntentChoice`
 *    field — the server treats undefined as "keep original from".
 *
 * `assetIds` is serialized as `assetIds[0]=…&assetIds[1]=…` so the
 * Zod schema picks it up as an array. `kitIds` is intentionally empty
 * (plan §G: kit fulfilment out of scope).
 */
function FulfilCheckoutForm({
  booking,
  assetIds,
  isLoading,
  disableSubmit,
  disabledReason,
}: FulfilCheckoutFormProps) {
  /**
   * Form DOM node ref — used as the portal container for the
   * `CheckoutDialog` alert so its submit buttons render inside this
   * form element (and therefore submit alongside our hidden inputs).
   * State (not ref) so the component re-renders once the form mounts
   * — guarantees `portalContainer` is the real DOM node when the
   * user opens the dialog.
   */
  const [formElement, setFormElement] = useState<HTMLFormElement | null>(null);

  return (
    <Form
      ref={setFormElement}
      id="fulfil-and-checkout-form"
      className="mb-4 flex max-h-full w-full"
      method="post"
    >
      <div className="flex w-full flex-col gap-2 p-3">
        {/* Hidden asset ids — matched + unmatched scans that will be
            attached to the booking in the transactional service. */}
        {assetIds.map((assetId, index) => (
          <input
            key={assetId}
            type="hidden"
            name={`assetIds[${index}]`}
            value={assetId}
          />
        ))}

        {disabledReason ? (
          <p className="text-center text-xs text-gray-600">{disabledReason}</p>
        ) : null}

        <div className="flex w-full justify-end gap-2">
          <Button type="button" variant="secondary" to="..">
            Cancel
          </Button>

          <CheckoutDialog
            booking={booking}
            disabled={disableSubmit || isLoading}
            portalContainer={formElement || undefined}
            formId="fulfil-and-checkout-form"
            // `grow` (the CheckoutDialog default) makes the button stretch
            // across the drawer — with the disabled primary-300 tint this
            // reads as an alarming peach block. Size to content instead.
            triggerClassName=""
          />
        </div>
      </div>
    </Form>
  );
}
