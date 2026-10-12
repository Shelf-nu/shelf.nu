/**
 * Fulfil Reservations & Check Out Drawer
 *
 * Drawer UI for the "Fulfil reservations & check out" scanner flow on a
 * booking that still has unassigned `BookingModelRequest` units. Scanning and
 * checking out happen in one flow, with the operator shown _what's expected_
 * up-front as pre-rendered pending rows grouped by `AssetModel`, with
 * per-model progress strips.
 *
 * Buckets (top-to-bottom):
 *
 *   1. Pending model rows       — `booked - matched` synthetic rows
 *                                  per expected model, gray "Pending"
 *                                  badge, no actions.
 *   2. Matched scanned rows     — QR scans whose resolved asset's
 *                                  `assetModelId` matches an expected
 *                                  model and whose session count is
 *                                  within `booked`. Green "Ready".
 *                                  Scanned kits carrying such members
 *                                  sit here too.
 *   3. Unmatched scanned rows   — off-model scans OR over-scans of an
 *                                  expected model, plus kits whose
 *                                  members assign nothing. Yellow
 *                                  warning badge clarifying the item
 *                                  will both land on the booking _and_
 *                                  go with this checkout.
 *   4. Already included         — concrete `BookingAsset`s already on
 *                                  the booking. Collapsed by default,
 *                                  green "Already included" chip,
 *                                  read-only.
 *
 * Kits take part in the same matching. A scanned kit goes on the booking
 * whole and its INDIVIDUAL members assign outstanding reserved units on the
 * way, exactly as loose scans of those members would. Members are never
 * submitted as loose asset ids — the form sends the kit id and the server
 * resolves it into kit-driven rows.
 *
 * The submit button integrates the existing `CheckoutDialog`, so the
 * early-checkout prompt matches the non-fulfil checkout path. A check-out
 * needs at least one item to go out and nothing more: the button is enabled
 * once something would leave, and when reserved units are still unassigned
 * the dialog names them for the operator to confirm. Those units stay open on
 * the booking.
 *
 * What "something would leave" means depends on the session. When submit
 * sends the whole booking out, items already on it count. When it sends out
 * only scanned items (explicit check-out, or a booking already underway), a
 * scan is required, and scanning an item already on the booking is how that
 * item gets checked out.
 *
 * This component **only reads atoms** — the fulfil session is seeded
 * by the parent route via `useBookingFulfilSessionInitialization`. The
 * drawer renders nothing when the session atom is null (transient
 * unmount state).
 *
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
import { AssetType } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { Package as PackageIcon } from "lucide-react";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  expectedModelRequestsAtom,
  fulfilSessionAtom,
  removeScannedItemAtom,
  removeMultipleScannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
  scannedItemsAtom,
  type FulfilSessionInfo,
} from "~/atoms/qr-scanner";
import CheckoutDialog, {
  CheckoutIntentEnum,
} from "~/components/booking/checkout-dialog";
import type { ModelProgress } from "~/components/booking/model-pending-rows";
import { buildPendingModelRows } from "~/components/booking/model-pending-rows";
import { ModelProgressStrips } from "~/components/booking/model-progress-strips";
import { Form } from "~/components/custom-form";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import type { CheckoutSourceQuestion } from "~/modules/booking/checkout-source-location";
import type {
  ScannedAssetRow,
  ScannedKitRow,
} from "~/modules/booking-model-request/scan-matching";
import { matchScansToModelRequests } from "~/modules/booking-model-request/scan-matching";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { BADGE_COLORS } from "~/utils/badge-colors";
import type { UnassignedModelUnits } from "~/utils/booking-model-requests";
import { tw } from "~/utils/tw";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import { DefaultLoadingState, GenericItemRow, Tr } from "../generic-item-row";
import { ScanItemGroup } from "../scan-item-group";

/**
 * Zod schema for the fulfil-and-checkout form payload.
 *
 * - `assetIds`: every resolved asset scan the submit acts on. The server
 *   assigns matching assets to outstanding `BookingModelRequest` rows,
 *   adds off-model assets as new `BookingAsset` rows, and checks out.
 *   Kit members are not listed here — sending one both as a loose id and
 *   inside its kit would book it twice.
 * - `kitIds`: every resolved kit scan. The server resolves each into
 *   kit-driven `BookingAsset` rows and assigns their members to
 *   outstanding `BookingModelRequest` rows.
 * - `checkoutIntentChoice`: populated only by the `CheckoutDialog`
 *   early-checkout alert buttons. Undefined on the plain submit path
 *   (not-early) — the server treats undefined as "keep original
 *   `from`".
 *
 * Exported so the route action can import and reuse it.
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
  /**
   * Pools already on the booking that sit at two or more locations and have
   * not gone out yet. The check-out confirmation asks where each one's units
   * leave from, for the ones this submit sends out.
   */
  sourceQuestions?: CheckoutSourceQuestion[];
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
  sourceQuestions,
}: FulfilReservationsDrawerProps) {
  const session = useAtomValue(fulfilSessionAtom);
  const expectedModelRequests = useAtomValue(expectedModelRequestsAtom);
  const items = useAtomValue(scannedItemsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  /**
   * Ids of the concrete `BookingAsset`s already on the booking. An asset in
   * here can never be a fresh match, whether it arrives as a loose scan or
   * inside a scanned kit.
   */
  const alreadyIncludedIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of session?.alreadyIncluded ?? []) {
      set.add(item.id);
    }
    return set;
  }, [session?.alreadyIncluded]);

  /**
   * Already-included assets whose row still answers no reservation.
   *
   * The server decides this, because it depends on the row's stamp rather than
   * on anything the scan can see. An asset listed twice, once standalone and
   * once through a kit, is claimable if any of its entries says so.
   */
  const claimableIncludedIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of session?.alreadyIncluded ?? []) {
      if (item.claimable) set.add(item.id);
    }
    return set;
  }, [session?.alreadyIncluded]);

  /**
   * Classify scanned items into asset rows (matched / unmatched / duplicate /
   * included) and kit rows, and tally what each assigns against the
   * outstanding reservations. The tally is derived per-render (not stored in
   * state) so a row can change bucket as the upstream model list changes.
   *
   * Delegates to `matchScansToModelRequests`, shared with the scan-to-assign
   * drawer so the two never drift from each other or from the server write.
   */
  const scannedBuckets = useMemo(
    () =>
      matchScansToModelRequests({
        items,
        expectedModelRequests,
        alreadyIncludedIds,
        claimableIncludedIds,
        checksOutScannedOnly: session?.checksOutScannedOnly ?? false,
      }),
    [
      items,
      expectedModelRequests,
      alreadyIncludedIds,
      claimableIncludedIds,
      session?.checksOutScannedOnly,
    ]
  );

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
   * Total units still unassigned across all models, after this session's
   * matched scans. Drives the footer notice. Uses `remaining` (outstanding
   * units) not `booked` so pre-fulfilled units don't count as "still needed".
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
   * Asset ids to submit: every resolved scan except `duplicate` rows.
   * Unresolved scans are excluded — the server can't act on an id we don't
   * know yet; operators see the loading state and submit once resolved.
   * `duplicate` rows are excluded because the whole booking goes out anyway.
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
   * The "From location" questions for what this submit sends out: every pool
   * on the booking when the whole booking goes out, only the scanned ones
   * when only scanned items leave.
   */
  const sourceQuestionsToAsk = useMemo(() => {
    if (!sourceQuestions?.length) return [];
    if (!session?.checksOutScannedOnly) return sourceQuestions;
    const scanned = new Set(assetIdsToSubmit);
    return sourceQuestions.filter((question) => scanned.has(question.assetId));
  }, [sourceQuestions, session?.checksOutScannedOnly, assetIdsToSubmit]);

  /**
   * Kit ids to submit: every resolved kit scan. Unresolved scans are excluded
   * for the same reason asset scans are — the server can't act on an id we
   * don't know yet.
   *
   * Their members stay out of `assetIdsToSubmit`: the server resolves each
   * kit into kit-driven `BookingAsset` rows, and a member sent as a loose id
   * as well would land on the booking twice.
   */
  const kitIdsToSubmit = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const row of scannedBuckets.kitRows) {
      const id = row.kit?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }, [scannedBuckets.kitRows]);

  /**
   * Synthetic pending rows: one per outstanding unit per model. Built after
   * all hooks so the hook-count is stable across renders; safe because it
   * reads only memoized values above.
   *
   * Delegates to `buildPendingModelRows`, shared with the scan-to-assign
   * drawer so both screens ask for the same units.
   */
  const pendingModelRows = useMemo(
    () => buildPendingModelRows(progressByModel),
    [progressByModel]
  );

  // Declared above the early return below: every hook in this component
  // must run on every render, and the blocker's inputs are all resolved by
  // this point.
  /**
   * Units the scan would take out of a kit.
   *
   * An INDIVIDUAL asset committed to a kit is not a free unit: sending it out
   * alone answers the reservation and checks the booking out with the kit
   * split — one item in the field, the rest on the shelf. The server refuses
   * these, so the block here is what turns a refusal at submit into something
   * the operator can see and fix while scanning.
   *
   * Not blocked when the asset's kit was scanned too (that is how a member is
   * meant to go out) or when it is already on the booking (it is committed
   * through the row it has, so the scan takes it nowhere new).
   */
  const kitMemberScanIds = useMemo(() => {
    const scannedKitIds = new Set(
      Object.values(items)
        .filter((item) => item?.type === "kit" && item?.data)
        .map((item) => (item?.data as KitFromQr).id)
    );

    return scannedBuckets.rows
      .filter((row) => {
        const asset = row.asset;
        if (!asset || asset.type !== AssetType.INDIVIDUAL) return false;
        if (alreadyIncludedIds.has(asset.id)) return false;
        const memberships = asset.assetKits ?? [];
        if (memberships.length === 0) return false;
        return !memberships.some((membership) =>
          scannedKitIds.has(membership.kitId)
        );
      })
      .map((row) => row.asset!.id);
  }, [scannedBuckets.rows, items, alreadyIncludedIds]);

  // Codes that resolved to nothing. The matcher parks them with the
  // unmatched rows so their row still mounts; here they block.
  const invalidCodeQrIds = Object.entries(items)
    .filter(([, item]) => !!item?.error)
    .map(([qrId]) => qrId);

  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs: [
      {
        id: "kit-members",
        condition: kitMemberScanIds.length > 0,
        count: kitMemberScanIds.length,
        message: (count: number) => (
          <>
            <strong>{`${count} asset${count > 1 ? "s" : ""} `}</strong>
            {count > 1 ? "belong" : "belongs"} to a kit.
          </>
        ),
        description:
          "Scan the kit to take all of it, or scan another unit of the same model. Sending one member out on its own would split the kit.",
        onResolve: () => removeAssetsFromList(kitMemberScanIds),
      },
      {
        id: "invalid-codes",
        condition: invalidCodeQrIds.length > 0,
        count: invalidCodeQrIds.length,
        message: (count: number) => (
          <>
            <strong>{`${count} QR code${count > 1 ? "s" : ""}`}</strong>{" "}
            {count > 1 ? "are" : "is"} invalid.
          </>
        ),
        onResolve: () => removeItemsFromList(invalidCodeQrIds),
      },
    ],
  });

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
        <ScannedAssetRowBody
          asset={data as AssetFromQr}
          bucket={row.bucket}
          viaKitName={row.viaKitName}
          claimedModelName={row.claimedModelName}
        />
      )}
    />
  );

  /** Render a single scanned kit row. */
  const renderScannedKitRow = (row: ScannedKitRow): ReactNode => (
    <GenericItemRow
      key={row.qrId}
      qrId={row.qrId}
      item={items[row.qrId]}
      onRemove={removeItem}
      renderLoading={(pendingQrId, error) => (
        <DefaultLoadingState qrId={pendingQrId} error={error} />
      )}
      renderItem={(data) => (
        <ScannedKitRowBody
          kit={data as KitFromQr}
          matchedMemberCount={row.matchedMemberCount}
        />
      )}
    />
  );

  /**
   * Renders the list as foldable groups, each its own card, matching the other
   * booking scan drawers:
   * - "Scanned this session" (reopens on a new scan), in the order the
   *   operator should read it: scans that assign reserved units (with the kits
   *   that do), members riding with their kit, items already on the booking,
   *   then the red "Already on this booking" rows above the yellow unmatched
   *   warnings, so the stronger signal comes first.
   * - "Pending": reserved units no scan has assigned yet.
   * - "Already included": rows on the booking before this session, folded.
   * A group with nothing in it is not rendered.
   */
  const renderGroups = (): ReactNode => {
    const matched = scannedBuckets.rows.filter((r) => r.bucket === "matched");
    const matchingKits = scannedBuckets.kitRows.filter(
      (r) => r.matchedMemberCount > 0
    );
    const nonMatchingKits = scannedBuckets.kitRows.filter(
      (r) => r.matchedMemberCount === 0
    );
    const claimed = scannedBuckets.rows.filter((r) => r.bucket === "claimed");
    const included = scannedBuckets.rows.filter((r) => r.bucket === "included");
    const duplicate = scannedBuckets.rows.filter(
      (r) => r.bucket === "duplicate"
    );
    const unmatched = scannedBuckets.rows.filter(
      (r) => r.bucket === "unmatched"
    );
    const viaKit = scannedBuckets.rows.filter((r) => r.bucket === "viaKit");
    const scannedCount = Object.keys(items).length;

    return (
      <>
        {scannedCount > 0 ? (
          <ScanItemGroup
            label="Scanned this session"
            count={scannedCount}
            tone="active"
            openWhenCountGrows
          >
            {matched.map(renderScannedItemRow)}
            {claimed.map(renderScannedItemRow)}
            {matchingKits.map(renderScannedKitRow)}
            {viaKit.map(renderScannedItemRow)}
            {included.map(renderScannedItemRow)}
            {duplicate.map(renderScannedItemRow)}
            {unmatched.map(renderScannedItemRow)}
            {nonMatchingKits.map(renderScannedKitRow)}
          </ScanItemGroup>
        ) : null}

        {pendingModelRows.length > 0 ? (
          <ScanItemGroup
            label="Pending"
            count={pendingModelRows.length}
            tone="muted"
          >
            {pendingModelRows.map((row) => (
              <PendingModelRow
                key={row.key}
                assetModelName={row.assetModelName}
              />
            ))}
          </ScanItemGroup>
        ) : null}

        {session.alreadyIncluded.length > 0 ? (
          <ScanItemGroup
            label="Already included"
            count={session.alreadyIncluded.length}
            tone="done"
            defaultOpen={false}
          >
            <AlreadyIncludedRows assets={session.alreadyIncluded} />
          </ScanItemGroup>
        ) : null}
      </>
    );
  };

  /**
   * A check-out needs at least one item to go out. Items already on the
   * booking count only when submit sends the whole booking out.
   */
  const hasSomethingToCheckOut =
    assetIdsToSubmit.length > 0 ||
    kitIdsToSubmit.length > 0 ||
    (!session.checksOutScannedOnly && session.alreadyIncluded.length > 0);
  const shouldDisableSubmit = Boolean(isLoading) || !hasSomethingToCheckOut;
  const notice = !hasSomethingToCheckOut
    ? "Scan at least one item to check out"
    : pendingUnitCount > 0
    ? `${pendingUnitCount} reserved unit${
        pendingUnitCount === 1 ? "" : "s"
      } still unassigned`
    : null;
  const unassignedUnits = progressByModel.map((model) => ({
    name: model.assetModelName,
    count: Math.max(0, model.remaining - model.matched),
  }));

  return (
    <ConfigurableDrawer
      schema={fulfilAndCheckoutSchema}
      items={items}
      onClearItems={clearList}
      title="Fulfil reservations & check out"
      isLoading={isLoading}
      renderGroups={renderGroups}
      // Render body even when nothing has been scanned yet — pending
      // rows still need to be visible so the operator knows what's
      // expected.
      renderWhenEmpty
      Blockers={Blockers}
      disableSubmit={hasBlockers}
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
          kitIds={kitIdsToSubmit}
          isLoading={isLoading}
          // This drawer submits through `CheckoutDialog`, not the drawer's own
          // button, so `ConfigurableDrawer`'s `disableSubmit` never reaches it
          // — the blocker has to be folded in here too or it would show a
          // warning over a live button.
          disableSubmit={shouldDisableSubmit || hasBlockers}
          notice={notice}
          unassignedUnits={unassignedUnits}
          sourceQuestions={sourceQuestionsToAsk}
          // Only a RESERVED booking's first check-out can move its start date.
          suppressEarlyCheckoutPrompt={session.bookingStatus !== "RESERVED"}
        />
      }
    />
  );
}

/**
 * Drawer header: booking name, description, and per-model progress strips.
 *
 * Rendered as the drawer's `headerContent` so it stays pinned while the
 * scanned/pending list scrolls underneath. The strips are
 * `ModelProgressStrips`; this component owns only the booking link and the
 * screen's descriptive copy, since those are this drawer's own chrome and
 * not shared with the other booking scanner.
 */
function FulfilHeader({
  session,
  progressByModel,
}: {
  session: Exclude<FulfilSessionInfo, null>;
  progressByModel: ModelProgress[];
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

        <ModelProgressStrips
          progressByModel={progressByModel}
          idPrefix="fulfil"
        />
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
 * - `"viaKit"`    → blue chip naming the scanned kit it arrives with. Not a
 *   warning and not a second assignment: the kit row is what assigns it, and
 *   this row says so rather than looking like an idle duplicate.
 * - `"unmatched"` → yellow warning badge. Copy explicitly states the
 *   asset will land on the booking _and_ go with this checkout so
 *   the operator knows both side-effects are coupled into one submit
 *   (the warning has to be clear about both).
 * - `"duplicate"` → rose warning badge. The asset is already on the
 *   booking and goes out with it anyway; the scan is a no-op and is
 *   dropped from the submit payload.
 * - `"included"`  → green "Ready to check out" chip. The asset is already
 *   on the booking and this scan checks it out.
 */
function ScannedAssetRowBody({
  asset,
  bucket,
  viaKitName,
  claimedModelName,
}: {
  asset: AssetFromQr;
  bucket: ScannedAssetRow["bucket"];
  viaKitName?: string;
  claimedModelName?: string;
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
          ) : bucket === "viaKit" ? (
            <Badge
              color={BADGE_COLORS.blue.bg}
              textColor={BADGE_COLORS.blue.text}
              withDot={false}
              className="max-w-full"
            >
              {viaKitName
                ? `Arrives with ${viaKitName}`
                : "Arrives with its kit"}
            </Badge>
          ) : bucket === "claimed" ? (
            <Badge
              color={BADGE_COLORS.green.bg}
              textColor={BADGE_COLORS.green.text}
              withDot={false}
              className="max-w-full"
            >
              {claimedModelName
                ? `Already here, now counts toward ${claimedModelName}`
                : "Already here, now counts"}
            </Badge>
          ) : bucket === "included" ? (
            <Badge
              color={BADGE_COLORS.green.bg}
              textColor={BADGE_COLORS.green.text}
              withDot={false}
            >
              Ready to check out
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
 * Body of a scanned-kit row (rendered inside `GenericItemRow`'s `renderItem`
 * slot). A kit always lands on the booking and always goes out with this
 * check-out, so the badge reports the one thing that varies: how many of its
 * members assign an outstanding reserved unit.
 *
 * A kit that assigns none carries the same yellow warning as an off-model
 * asset scan — it is accepted, and the operator should see that it does not
 * move the progress strips.
 *
 * @param kit - Resolved kit payload from the scanned-item endpoint.
 * @param matchedMemberCount - Members assigning a reserved unit; see
 *   {@link ScannedKitRow}.
 */
function ScannedKitRowBody({
  kit,
  matchedMemberCount,
}: {
  kit: KitFromQr;
  matchedMemberCount: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="word-break whitespace-break-spaces font-medium text-gray-800">
        {kit.name}
        <span className="ml-1.5 text-xs font-medium text-gray-500">
          {kit._count.assetKits}{" "}
          {kit._count.assetKits === 1 ? "asset" : "assets"}
        </span>
      </span>
      <div className="flex flex-wrap items-center gap-1">
        <span className={assetTypePillClass}>kit</span>
        {matchedMemberCount > 0 ? (
          <Badge
            color={BADGE_COLORS.green.bg}
            textColor={BADGE_COLORS.green.text}
            withDot={false}
            className="max-w-full"
          >
            {matchedMemberCount === 1
              ? "Assigns 1 reserved unit"
              : `Assigns ${matchedMemberCount} reserved units`}
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
  );
}

/**
 * The rows already on the booking before this session started
 * (`BookingAsset`s). The drawer boxes them in a folded "Already included"
 * card: the operator usually only cares about what is still outstanding, but
 * can open it to confirm the full picture.
 *
 * Read-only: no remove button, no inputs. The server owns these rows; this
 * scanner flow only _adds_ new ones.
 */
function AlreadyIncludedRows({
  assets,
}: {
  assets: Exclude<FulfilSessionInfo, null>["alreadyIncluded"];
}) {
  return (
    <>
      {assets.map((asset) => (
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
      ))}
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
  /** Scanned kit ids to attach to the booking as kit-driven rows. */
  kitIds: string[];
  /** `true` while a submit is in-flight. */
  isLoading?: boolean;
  /** `true` while nothing would go out, or while a submit is in flight. */
  disableSubmit: boolean;
  /**
   * One line beside the buttons: why nothing can be checked out yet, or how
   * many reserved units are still unassigned. `null` shows nothing.
   */
  notice: string | null;
  /** Reserved units still unassigned, for the check-out confirmation. */
  unassignedUnits: UnassignedModelUnits[];
  /** Skips the early check-out prompt; see `CheckoutDialog`. */
  suppressEarlyCheckoutPrompt: boolean;
  /** Pools to ask "From location" for; see `CheckoutDialog`. */
  sourceQuestions: CheckoutSourceQuestion[];
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
 * `assetIds` and `kitIds` are serialized as `assetIds[0]=…&assetIds[1]=…`
 * so the Zod schema picks each up as an array.
 */
function FulfilCheckoutForm({
  booking,
  assetIds,
  kitIds,
  isLoading,
  disableSubmit,
  notice,
  unassignedUnits,
  suppressEarlyCheckoutPrompt,
  sourceQuestions,
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
      className="flex w-full"
      method="post"
    >
      {/* The footer is pinned, so every pixel here is one the scan list does
          not get. The remaining-units line shares the buttons' row rather than
          taking one of its own, and wraps above them only when the drawer is
          too narrow to hold both. */}
      <div className="flex w-full flex-wrap items-center justify-end gap-x-3 gap-y-2 px-3 pb-4 pt-3">
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

        {/* Hidden kit ids — the server resolves each into kit-driven rows
            and assigns their members to outstanding reservations. */}
        {kitIds.map((kitId, index) => (
          <input
            key={kitId}
            type="hidden"
            name={`kitIds[${index}]`}
            value={kitId}
          />
        ))}

        {notice ? (
          <p className="mr-auto text-xs text-gray-600">{notice}</p>
        ) : null}

        <Button type="button" variant="secondary" to="..">
          Cancel
        </Button>

        <CheckoutDialog
          booking={booking}
          disabled={disableSubmit || isLoading}
          portalContainer={formElement || undefined}
          formId="fulfil-and-checkout-form"
          unassignedUnits={unassignedUnits}
          sourceQuestions={sourceQuestions}
          suppressEarlyCheckoutPrompt={suppressEarlyCheckoutPrompt}
          // `grow` (the CheckoutDialog default) makes the button stretch
          // across the drawer — with the disabled primary-300 tint this
          // reads as an alarming peach block. Size to content instead.
          triggerClassName=""
        />
      </div>
    </Form>
  );
}
