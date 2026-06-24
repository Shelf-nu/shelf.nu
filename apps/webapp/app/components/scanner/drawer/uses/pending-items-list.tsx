/**
 * Pending Items List (shared between check-in and check-out drawers)
 *
 * Extracted from `partial-checkin-drawer.tsx` so the same pending-list
 * rendering primitives (foldable kit groups, indented kit-child rows,
 * loose individual rows, loose qty-tracked rows with the "Check N
 * without scanning" affordance) can be reused by the check-out drawer.
 *
 * The visible difference between the two consumers is small enough to
 * collapse onto a single `mode: "checkin" | "checkout"` discriminator:
 *
 *  - Button label   — "Check in without scanning" vs
 *                     "Check out without scanning".
 *  - Tooltip text   — "still to reconcile" vs "still to check out".
 *  - Section header — "Pending check-in" / "Pending check-out" (the
 *                     caller already passes the full label to
 *                     `<SectionHeader />`; this just keeps the prop
 *                     surface symmetric).
 *  - React keys     — `pending-checkin-*` vs `pending-checkout-*` so a
 *                     hypothetical test that mounts both modes in the
 *                     same tree wouldn't collide.
 *
 * For `mode="checkin"` the rendered output is byte-identical to the
 * pre-extract inline definitions in `partial-checkin-drawer.tsx`.
 *
 * @see {@link file://./partial-checkin-drawer.tsx} — original home of
 *   these renderers; now delegates here.
 * @see {@link file://./partial-checkout-drawer.tsx} — second consumer
 *   wired in a follow-up commit.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

import type { BookingExpectedAsset } from "~/atoms/qr-scanner";
import { AvailabilityBadge } from "~/components/booking/availability-label";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Button } from "~/components/shared/button";
import { tw } from "~/utils/tw";

import { Tr } from "../generic-item-row";

/** Narrowed type alias for readability below. */
type QtyExpectedAsset = Extract<
  BookingExpectedAsset,
  { kind: "QUANTITY_TRACKED" }
>;
type IndividualExpectedAsset = Extract<
  BookingExpectedAsset,
  { kind: "INDIVIDUAL" }
>;

/** Direction this list is rendering for — drives small copy + key differences. */
export type PendingItemsListMode = "checkin" | "checkout";

/**
 * Shared Tailwind class vocabulary for the little "asset"/"kit" pill
 * next to the row title. Kept in one place so the pending rows and the
 * scanned rows look identical.
 */
const assetTypePillClass = tw(
  "inline-block bg-gray-50 px-[6px] py-[2px]",
  "rounded-md border border-gray-200",
  "text-xs text-gray-700"
);

/**
 * Per-mode copy. Centralised so the two callers stay in sync if we tweak
 * a tooltip or a button label.
 */
type ModeCopy = {
  /** Label on the secondary action button next to a pending qty row. */
  quickActionButton: string;
  /** Tooltip for the "needs N" chip on pending qty rows. */
  needsTooltipTitle: string;
  /**
   * Body of the "needs N" tooltip — function so we can interpolate the
   * remaining-unit count + pluralise correctly.
   */
  needsTooltipBody: (remaining: number) => string;
  /** Tooltip body shown on the gray "Pending" pill of a qty row. */
  pendingQtyTooltipBody: string;
  /** Tooltip body shown on the kit-header's "Pending" pill. */
  pendingKitTooltipBody: string;
  /**
   * Prefix used to namespace `Tr` `key`s so two modes can't collide in
   * the same test tree.
   */
  keyPrefix: string;
};

const COPY_BY_MODE: Record<PendingItemsListMode, ModeCopy> = {
  checkin: {
    quickActionButton: "Check in without scanning",
    needsTooltipTitle: "Remaining units",
    needsTooltipBody: (remaining) =>
      `${remaining} unit${
        remaining === 1 ? "" : "s"
      } still to be reconciled on this booking.`,
    pendingQtyTooltipBody:
      "This quantity-tracked asset still has units to reconcile on this booking.",
    pendingKitTooltipBody:
      "This kit's assets are still outstanding. Scan the kit QR (or check in individual quantity-tracked members below).",
    keyPrefix: "pending-checkin",
  },
  checkout: {
    quickActionButton: "Check out without scanning",
    needsTooltipTitle: "Remaining units",
    needsTooltipBody: (remaining) =>
      `${remaining} unit${
        remaining === 1 ? "" : "s"
      } still to check out on this booking.`,
    pendingQtyTooltipBody:
      "This quantity-tracked asset still has units to check out on this booking.",
    pendingKitTooltipBody:
      "This kit's assets are still outstanding. Scan the kit QR (or check out individual quantity-tracked members below).",
    keyPrefix: "pending-checkout",
  },
};

/**
 * Section header row between drawer buckets. Purely visual — gives
 * operators a clear split between "checked in this session" (active
 * rows) and "pending" (untouched) so the presence/absence of a
 * disposition form isn't the sole signal. Two tones:
 *
 * - `"active"` — slightly tinted background, primary text. Marks the
 *   "in progress" section above scanned / quick-checked rows.
 * - `"muted"` — neutral gray background, dimmed text. Marks the
 *   "pending" section below.
 *
 * Renders as a full-width `<tr>` so it lives inside the existing
 * `<tbody>` without breaking DOM semantics.
 */
export function SectionHeader({
  label,
  tone,
}: {
  label: string;
  tone: "active" | "muted";
}) {
  const toneClass =
    tone === "active"
      ? "bg-blue-50 text-blue-800 border-t border-blue-100"
      : "bg-gray-50 text-gray-600 border-t border-gray-100";

  return (
    <Tr key={`section-${tone}-${label}`} skipEntrance>
      <td
        colSpan={2}
        className={tw(
          "px-4 py-3 text-xs font-semibold uppercase tracking-wide md:px-6",
          toneClass
        )}
      >
        {label}
      </td>
    </Tr>
  );
}

/**
 * Groups pending assets that belong to the same kit under a foldable kit
 * "header" row, with the child rows rendered below. Children are a mix of
 * INDIVIDUAL assets (no action — scan the kit QR) and QUANTITY_TRACKED
 * slices (Polish-7b: their kit-driven slice, each with its own "Check N
 * without scanning" affordance, since qty assets have no physical
 * barcode).
 *
 * Grouping is by the slice's OWN `kitId`, so an asset's standalone slice
 * is NOT pulled into this group even when its kit-driven slice is here.
 */
function PendingKitGroup({
  kit,
  assets,
  onQuickAction,
  copy,
}: {
  kit: { id: string; name: string; mainImage: string | null };
  assets: BookingExpectedAsset[];
  onQuickAction: (asset: QtyExpectedAsset) => void;
  copy: ModeCopy;
}) {
  // Collapsed by default — a pending kit is N rows of noise while the
  // operator is still scanning; a single summary row with a count is
  // enough to know it's there. Expanding lets them audit which
  // specific children are outstanding.
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tr key={`${copy.keyPrefix}-kit-header-${kit.id}`} skipEntrance>
        <td className="w-full p-0 md:p-0">
          {/* Row dimensions match `renderPendingIndividualAsset` — same
              `p-4` + `54px` thumbnail — so consecutive kit and loose
              rows read as a uniform list. A compact rotating chevron
              sits before the thumbnail so the "foldable" affordance
              is unmissable even when the kit has its own image. */}
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-gray-50 md:px-6"
          >
            <div className="flex min-w-0 items-center gap-2">
              <ChevronDownIcon
                aria-hidden="true"
                className={tw(
                  "size-5 shrink-0 text-gray-500 transition-transform duration-150",
                  open ? "rotate-0" : "-rotate-90"
                )}
              />
              {kit.mainImage ? (
                <ImageWithPreview
                  thumbnailUrl={kit.mainImage}
                  alt={kit.name || "Kit"}
                  className="size-[54px] rounded-[2px]"
                />
              ) : (
                <div className="flex size-[54px] shrink-0 items-center justify-center rounded-[2px] border border-gray-200 bg-gray-50">
                  {/* Placeholder for image-less kits — the chevron on
                      the left is still the primary fold affordance. */}
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                    Kit
                  </span>
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="word-break whitespace-break-spaces font-medium text-gray-800">
                  {kit.name}
                  <span className="ml-1 text-xs font-normal text-gray-500">
                    ({assets.length} {assets.length === 1 ? "asset" : "assets"})
                  </span>
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <span className={assetTypePillClass}>kit</span>
                  <AvailabilityBadge
                    badgeText="Pending"
                    tooltipTitle="Pending kit"
                    tooltipContent={copy.pendingKitTooltipBody}
                    className="border-gray-200 bg-gray-50 text-gray-600"
                  />
                </div>
              </div>
            </div>
          </button>
        </td>
        <td>
          <div className="w-[52px]" />
        </td>
      </Tr>
      {open
        ? assets.map((asset) =>
            asset.kind === "QUANTITY_TRACKED" ? (
              <PendingKitQtyChild
                key={`${copy.keyPrefix}-kit-child-${asset.bookingAssetId}`}
                asset={asset}
                onQuickAction={() => onQuickAction(asset)}
                copy={copy}
              />
            ) : (
              <Tr
                key={`${copy.keyPrefix}-kit-child-${asset.bookingAssetId}`}
                skipEntrance
              >
                <td className="w-full p-0 md:p-0">
                  {/* Indented child row. Left border + padding mirrors
                      the booking-overview kit grouping so it's visually
                      obvious these assets belong to the kit above. */}
                  <div className="flex items-center justify-between gap-3 border-l-2 border-gray-200 p-4 pl-8 md:px-6 md:pl-10">
                    <div className="flex items-center gap-2">
                      <ImageWithPreview
                        thumbnailUrl={asset.thumbnailImage || asset.mainImage}
                        alt={asset.title || "Asset"}
                        className="size-[40px] rounded-[2px]"
                      />
                      <div className="flex flex-col gap-1">
                        <span className="word-break whitespace-break-spaces text-sm font-medium text-gray-700">
                          {asset.title}
                        </span>
                        <div className="flex flex-wrap items-center gap-1">
                          <span className={assetTypePillClass}>asset</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <div className="w-[52px]" />
                </td>
              </Tr>
            )
          )
        : null}
    </>
  );
}

/**
 * Indented kit-child row for a pending QUANTITY_TRACKED slice. Mirrors the
 * INDIVIDUAL kit-child layout (left border, 40px thumbnail) but adds the
 * qty badges + "Check N without scanning" button so a kit-driven qty
 * slice can be reconciled without leaving the kit group (Polish-7b).
 */
function PendingKitQtyChild({
  asset,
  onQuickAction,
  copy,
}: {
  asset: QtyExpectedAsset;
  onQuickAction: () => void;
  copy: ModeCopy;
}) {
  const reconciled = Math.max(0, asset.booked - asset.remaining);
  const isPartial = asset.logged > 0 && reconciled > 0;

  return (
    <Tr
      key={`${copy.keyPrefix}-kit-child-${asset.bookingAssetId}`}
      skipEntrance
    >
      <td className="w-full p-0 md:p-0">
        <div className="flex flex-col gap-3 border-l-2 border-gray-200 p-4 pl-8 sm:flex-row sm:items-center sm:justify-between md:px-6 md:pl-10">
          <div className="flex min-w-0 items-center gap-2">
            <ImageWithPreview
              thumbnailUrl={asset.thumbnailImage || asset.mainImage}
              alt={asset.title || "Asset"}
              className="size-[40px] shrink-0 rounded-[2px]"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="word-break whitespace-break-spaces text-sm font-medium text-gray-700">
                {asset.title}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <span className={assetTypePillClass}>asset</span>
                {isPartial ? (
                  <AvailabilityBadge
                    badgeText={`${reconciled}/${asset.booked} reconciled`}
                    tooltipTitle="Partially reconciled"
                    tooltipContent="Some units were already reconciled in a previous check-in. The remainder can still be checked in below."
                    className="border-amber-200 bg-amber-50 text-amber-700"
                  />
                ) : (
                  <AvailabilityBadge
                    badgeText="Pending"
                    tooltipTitle="Pending check-in"
                    tooltipContent={copy.pendingQtyTooltipBody}
                    className="border-gray-200 bg-gray-50 text-gray-600"
                  />
                )}
                <AvailabilityBadge
                  badgeText={`needs ${asset.remaining}`}
                  tooltipTitle={copy.needsTooltipTitle}
                  tooltipContent={copy.needsTooltipBody(asset.remaining)}
                  className="border-blue-200 bg-blue-50 text-blue-700"
                />
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={onQuickAction}
            title="Skip scan — enter disposition inline below."
            className="w-full sm:w-auto sm:shrink-0"
          >
            {copy.quickActionButton}
          </Button>
        </div>
      </td>
      <td>
        <div className="w-[52px]" />
      </td>
    </Tr>
  );
}

/**
 * Render a pending (not-yet-scanned) INDIVIDUAL asset row. No action
 * buttons — operator must scan the QR code. Mirrors the audit drawer's
 * `renderPendingAsset` layout.
 */
function renderPendingIndividualAsset(
  asset: IndividualExpectedAsset,
  kit: { id: string; name: string } | undefined,
  copy: ModeCopy
): ReactNode {
  return (
    <Tr key={`${copy.keyPrefix}-${asset.bookingAssetId}`} skipEntrance>
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
              </span>
              {kit ? (
                <span className="text-xs text-gray-500">
                  Part of kit: {kit.name}
                </span>
              ) : null}
              <div className="flex flex-wrap items-center gap-1">
                <span className={assetTypePillClass}>asset</span>
                <AvailabilityBadge
                  badgeText="Pending"
                  tooltipTitle="Pending scan"
                  tooltipContent="This asset is part of the booking but has not been scanned yet."
                  className="border-gray-200 bg-gray-50 text-gray-600"
                />
              </div>
            </div>
          </div>
        </div>
      </td>
      <td>
        {/* No remove button for pending items */}
        <div className="w-[52px]" />
      </td>
    </Tr>
  );
}

/**
 * Render a pending (not-yet-scanned) QUANTITY_TRACKED asset row.
 *
 * - When `logged === 0`: show a gray "Pending" badge + a "needs N"
 *   chip (N = `remaining`).
 * - When `logged > 0` (partially reconciled by a previous session):
 *   show a progress badge reading "`booked - remaining`/`booked`
 *   reconciled" in place of "Pending".
 *
 * Always renders a **Check N without scanning** button on the right,
 * since qty-tracked assets typically have no physical barcode.
 */
function renderPendingQtyAsset(
  asset: QtyExpectedAsset,
  kit: { id: string; name: string } | undefined,
  onQuickAction: () => void,
  copy: ModeCopy
): ReactNode {
  // `booked - remaining` is the already-logged amount (clamped).
  const reconciled = Math.max(0, asset.booked - asset.remaining);
  const isPartial = asset.logged > 0 && reconciled > 0;

  return (
    <Tr key={`${copy.keyPrefix}-qty-${asset.bookingAssetId}`} skipEntrance>
      <td className="w-full p-0 md:p-0">
        {/* Mobile: content + button stack vertically (flex-col) so the
            "Check N without scanning" button drops below the asset
            details instead of being squeezed off-screen. Desktop
            (`sm:` ~640px+) keeps the side-by-side layout. */}
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <ImageWithPreview
              thumbnailUrl={asset.thumbnailImage || asset.mainImage}
              alt={asset.title || "Asset"}
              className="size-[54px] shrink-0 rounded-[2px]"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="word-break whitespace-break-spaces font-medium text-gray-800">
                {asset.title}
              </span>
              {kit ? (
                <span className="text-xs text-gray-500">
                  Part of kit: {kit.name}
                </span>
              ) : null}
              <div className="flex flex-wrap items-center gap-1">
                <span className={assetTypePillClass}>asset</span>

                {isPartial ? (
                  <AvailabilityBadge
                    badgeText={`${reconciled}/${asset.booked} reconciled`}
                    tooltipTitle="Partially reconciled"
                    tooltipContent="Some units were already reconciled in a previous check-in. The remainder can still be checked in below."
                    className="border-amber-200 bg-amber-50 text-amber-700"
                  />
                ) : (
                  <AvailabilityBadge
                    badgeText="Pending"
                    tooltipTitle="Pending check-in"
                    tooltipContent={copy.pendingQtyTooltipBody}
                    className="border-gray-200 bg-gray-50 text-gray-600"
                  />
                )}

                <AvailabilityBadge
                  badgeText={`needs ${asset.remaining}`}
                  tooltipTitle={copy.needsTooltipTitle}
                  tooltipContent={copy.needsTooltipBody(asset.remaining)}
                  className="border-blue-200 bg-blue-50 text-blue-700"
                />
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={onQuickAction}
            title="Skip scan — enter disposition inline below."
            className="w-full sm:w-auto sm:shrink-0"
          >
            {copy.quickActionButton}
          </Button>
        </div>
      </td>
      <td>
        {/* No remove button for pending items */}
        <div className="w-[52px]" />
      </td>
    </Tr>
  );
}

/**
 * Props for the shared pending-list renderer.
 *
 * The list interleaves three buckets, in order:
 *  1. Kit groups (foldable header + indented children — individuals and
 *     qty slices) keyed off each entry's OWN `kitId`.
 *  2. Loose individual rows (`kitId == null`).
 *  3. Loose qty rows (`kitId == null` — e.g. the standalone slice of an
 *     asset that's also in a kit).
 *
 * `pendingCount` is supplied by the caller (rather than derived) because
 * the caller already computes it for its own header label and we want to
 * avoid recomputing/diverging.
 */
export type PendingItemsListProps = {
  /** Direction this list renders for — drives small copy + key differences. */
  mode: PendingItemsListMode;
  /** Pending INDIVIDUAL entries (loose + kit children) to render. */
  pendingIndividuals: IndividualExpectedAsset[];
  /** Pending QUANTITY_TRACKED entries (loose + kit children) to render. */
  pendingQtyTracked: QtyExpectedAsset[];
  /**
   * Map of `kitId` → kit meta. Anything whose `kitId` is missing from
   * the map falls back to a loose row — defensive against loader/render
   * skew.
   */
  kitMetaById: Map<
    string,
    { id: string; name: string; mainImage: string | null }
  >;
  /**
   * Called when the operator clicks the "Check N without scanning"
   * button on a qty row. The caller wires the synthetic-entry dispatch
   * + any per-mode focus management.
   */
  onQuickAction: (asset: QtyExpectedAsset) => void;
  /**
   * Total pending count (`pendingIndividuals.length +
   * pendingQtyTracked.length`). Used to gate the muted section header.
   */
  pendingCount: number;
};

/**
 * Interleaves the three pending buckets (kit groups, loose individuals,
 * loose qty rows) under a single muted "Pending (N)" section header.
 * Returns `null` when there's nothing pending so the caller doesn't have
 * to gate on `pendingCount` itself.
 */
export function PendingItemsList({
  mode,
  pendingIndividuals,
  pendingQtyTracked,
  kitMetaById,
  onQuickAction,
  pendingCount,
}: PendingItemsListProps): ReactNode {
  const copy = COPY_BY_MODE[mode];

  // Partition into kit groups vs loose rows. Mirrors the
  // pre-extract logic in `partial-checkin-drawer.tsx`.
  const kitGroups = new Map<
    string,
    {
      kit: { id: string; name: string; mainImage: string | null };
      assets: BookingExpectedAsset[];
    }
  >();
  const looseIndividuals: IndividualExpectedAsset[] = [];
  const looseQty: QtyExpectedAsset[] = [];

  const pushToKit = (kitId: string, asset: BookingExpectedAsset) => {
    const kit = kitMetaById.get(kitId);
    if (!kit) {
      // Defensive: kit metadata missing → fall back to a loose row so
      // we still render the entry instead of dropping it silently.
      if (asset.kind === "INDIVIDUAL") looseIndividuals.push(asset);
      else looseQty.push(asset);
      return;
    }
    const existing = kitGroups.get(kit.id);
    if (existing) existing.assets.push(asset);
    else kitGroups.set(kit.id, { kit, assets: [asset] });
  };

  for (const asset of pendingIndividuals) {
    if (asset.kitId) pushToKit(asset.kitId, asset);
    else looseIndividuals.push(asset);
  }
  for (const asset of pendingQtyTracked) {
    if (asset.kitId) pushToKit(asset.kitId, asset);
    else looseQty.push(asset);
  }

  return (
    <>
      {/* Header for pending section. Same visual weight as the scanned
          header but muted — reinforces the bucket split without
          shouting. */}
      {pendingCount > 0 ? (
        <SectionHeader label={`Pending (${pendingCount})`} tone="muted" />
      ) : null}

      {[...kitGroups.values()].map(({ kit, assets }) => (
        <PendingKitGroup
          key={`${copy.keyPrefix}-kit-${kit.id}`}
          kit={kit}
          assets={assets}
          onQuickAction={onQuickAction}
          copy={copy}
        />
      ))}
      {looseIndividuals.map((asset) =>
        renderPendingIndividualAsset(asset, undefined, copy)
      )}
      {looseQty.map((asset) =>
        renderPendingQtyAsset(
          asset,
          undefined,
          () => onQuickAction(asset),
          copy
        )
      )}
    </>
  );
}
