/**
 * Stock Status Badge
 *
 * Renders the assets-index `Stock status` column: the derived verdict for a
 * QUANTITY_TRACKED asset's pool, from `classifyStockStatus`
 * (`@shelf/quantity-control`).
 *
 * Two deliberate rendering rules live here rather than at the call site, so
 * every surface that shows this verdict agrees:
 *
 * 1. **`NO_THRESHOLD` renders as an em dash, not a badge.** A pill there reads
 *    as a stock level, and "nobody set a reorder point" is the absence of an
 *    opinion. It is also the MAJORITY state in real workspaces (measured: 10 of
 *    12 quantity assets in a live account), so a grey pill would paint most of a
 *    catalogue as if it had been assessed.
 * 2. **An INDIVIDUAL asset (`status == null`) renders the shared empty value.**
 *    It has no pool, so the existing `Status` column answers for it.
 *
 * When a `breakdown` is supplied the badge also becomes a hover target showing
 * THAT ROW's numbers — available against the reorder point, and what is
 * consuming the difference. The verdict alone tells you a row needs attention
 * but not how bad it is, and the alternative was opening the asset page to find
 * out. The column-header tooltip explains what the words MEAN; this explains
 * what this asset's situation IS.
 *
 * Colors come from `BADGE_COLORS` per the repo rule; `SHORT` gets violet rather
 * than a hotter red because it is a commitment problem (in a booking workspace,
 * a double-booking) rather than a stock level, and reusing red would make it
 * indistinguishable from `NONE_FREE` at a glance.
 *
 * @see {@link file://../../../../../packages/quantity-control/src/stock-status.ts}
 * @see {@link file://../../../../../packages/labels/index.js} - the four strings.
 * @see {@link file://./assets-index/column-help-content.tsx} - the header legend.
 */

import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { STOCK_STATUS_LABELS } from "@shelf/labels";
import { ASSET_QUANTITY_FIGURE_LABELS } from "@shelf/labels";
import { committedUnits, type StockStatus } from "@shelf/quantity-control";
import { Link } from "react-router";
import { Badge } from "~/components/shared/badge";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/shared/hover-card";
import { BADGE_COLORS, type BadgeColorScheme } from "~/utils/badge-colors";

/**
 * Badge palette per verdict. `NO_THRESHOLD` is absent on purpose — it has no
 * badge, and the `Record` over the badged subset makes adding a status without
 * deciding its color a type error.
 */
const STOCK_STATUS_COLORS: Record<
  Exclude<StockStatus, "NO_THRESHOLD">,
  BadgeColorScheme
> = {
  SHORT: BADGE_COLORS.violet,
  NONE_FREE: BADGE_COLORS.red,
  LOW: BADGE_COLORS.amber,
  ENOUGH: BADGE_COLORS.green,
};

/**
 * This row's figures, for the hover detail. Every field is the same number the
 * neighbouring columns render, so the tooltip can never disagree with the row.
 */
export type StockStatusBreakdown = {
  /** `Asset.quantity` — every unit owned. */
  total: number;
  /** Free to hand over now: total minus custody, kits and checked-out. */
  available: number;
  /** Units held by custodians. */
  inCustody: number;
  /** Units earmarked to kits. */
  inKits: number;
  /** Units out on ONGOING/OVERDUE bookings. */
  checkedOut: number;
  /**
   * The LARGEST single upcoming booking, which is what the `SHORT` verdict is
   * computed from — not the sum of every upcoming booking.
   */
  largestUpcomingBooking: number;
  /** The reorder point, or `null` when nobody set one. */
  minQuantity: number | null;
  /** Free-text unit label ("pcs", "boxes"), when the asset has one. */
  unitOfMeasure?: string | null;
  /**
   * The upcoming booking claiming the most units — the one the `SHORT` verdict
   * is computed from. Present so the hover can NAME it and link to it: telling
   * someone they are two short without saying which booking is the shortfall
   * is a diagnosis, not a tool.
   */
  topBooking?: { id: string; name: string } | null;
  /**
   * This asset's id, so the no-reorder-point hover can link to the form that
   * sets one. Without it that hover says "set a reorder point" and offers no
   * way to do it — advice with no door, on the state that covers MOST quantity
   * assets in a real workspace.
   */
  assetId?: string | null;
};

/** Props for {@link StockStatusBadge}. */
type StockStatusBadgeProps = {
  /**
   * The verdict, or `null` for an INDIVIDUAL asset (no pool to judge). Pass the
   * value straight through from the loader — do not pre-filter `NO_THRESHOLD`,
   * because its rendering is this component's job.
   */
  status: StockStatus | null | undefined;
  /**
   * This row's figures. When present the badge gains a hover detail. Omitted by
   * the column-header legend, which renders these same badges as a key — a
   * tooltip nested inside a tooltip would be unreachable and is never wanted.
   */
  breakdown?: StockStatusBreakdown | null;
};

/** One line of the hover detail's stacked subtraction. */
function DetailRow({
  op,
  label,
  value,
  unit,
  isResult = false,
}: {
  op?: string;
  label: string;
  value: number;
  unit?: string | null;
  isResult?: boolean;
}) {
  return (
    <div
      className={
        isResult
          ? "mt-1 flex items-baseline gap-1.5 border-t border-gray-300 pt-1"
          : "flex items-baseline gap-1.5"
      }
    >
      <span className="w-2 shrink-0 text-xs text-gray-400">{op ?? ""}</span>
      <span
        className={
          isResult
            ? "flex-1 text-xs font-semibold text-gray-900"
            : "flex-1 text-xs text-gray-600"
        }
      >
        {label}
      </span>
      <span
        className={
          isResult
            ? "text-xs font-semibold tabular-nums text-gray-900"
            : "text-xs tabular-nums text-gray-600"
        }
      >
        {value}
        {unit ? ` ${unit}` : ""}
      </span>
    </div>
  );
}

/**
 * The hover detail: this asset's actual levels, and the reason the badge fired.
 *
 * Three rules, each of which came out of reading the rendered tooltip rather
 * than the code:
 *
 * 1. **Claim rows are omitted when zero.** A subtraction listing "− In kits 0"
 *    three times buries the one line that matters, and most assets are touched
 *    by only one or two of the three.
 * 2. **No claims at all ⇒ no box.** With every claim row dropped the box
 *    degenerated to `Total 200 = Available 200` — the same number twice, with an
 *    `=` implying arithmetic happened. The reason line above already says it.
 * 3. **The upcoming-booking figure gets its own line BELOW the result**, never a
 *    `−` row inside the subtraction. Those units are still on the shelf, so
 *    `Available` deliberately does not subtract them (see the `Available` column
 *    help). But it IS the number a `SHORT` verdict is computed from, so leaving
 *    it out made the box contradict its own headline: "12 units claimed, but you
 *    only own 10" over a box reading `Total 10 = Available 10`.
 *
 * @param props.status - The verdict being explained.
 * @param props.breakdown - This row's figures.
 * @returns The tooltip body.
 */
function StockStatusDetail({
  status,
  breakdown,
}: {
  /**
   * Narrowed to the BADGED statuses. `NO_THRESHOLD` has no label and no
   * verdict to explain — it gets its own, shorter hover — so letting it in here
   * would only make the label lookup unsound.
   */
  status: Exclude<StockStatus, "NO_THRESHOLD">;
  breakdown: StockStatusBreakdown;
}) {
  const {
    total,
    available,
    inCustody,
    inKits,
    checkedOut,
    largestUpcomingBooking,
    minQuantity,
    unitOfMeasure,
    topBooking,
  } = breakdown;
  const unit = unitOfMeasure ?? null;

  /** Appends the asset's own unit word, so the prose matches the figures. */
  const withUnit = (value: number) => `${value}${unit ? ` ${unit}` : ""}`;

  /** The claims that actually hold units. Empty ⇒ the box is skipped entirely. */
  const claims = [
    { label: "In custody", value: inCustody },
    { label: "In kits", value: inKits },
    { label: "Checked out", value: checkedOut },
  ].filter((claim) => claim.value > 0);

  /**
   * The one-line reason, quoting the comparison the verdict actually made.
   * `SHORT` quotes the largest single booking rather than the reserved total,
   * because that is the figure `classifyStockStatus` used — so it is read back
   * through the same helper rather than re-added by hand here.
   */
  const reason =
    status === "SHORT"
      ? `${withUnit(
          committedUnits({
            inCustody,
            inKits,
            checkedOut,
            largestUpcomingBooking,
          })
        )} claimed, but you only own ${withUnit(total)}`
      : status === "NONE_FREE"
      ? `Nothing free to hand over, out of ${withUnit(total)} owned`
      : status === "LOW"
      ? `${withUnit(
          available
        )} available, at or below your reorder point of ${withUnit(
          minQuantity ?? 0
        )}`
      : `${withUnit(
          available
        )} available, above your reorder point of ${withUnit(
          minQuantity ?? 0
        )}`;

  /**
   * `LOW` and `ENOUGH` are DEFINED against the reorder point, so their reason
   * line already quotes it — repeating it underneath just says 50 twice. The two
   * commitment verdicts never mention it, and there it is the missing context.
   */
  const showReorderPoint =
    minQuantity != null && (status === "SHORT" || status === "NONE_FREE");

  return (
    <div className="flex max-w-xs flex-col gap-2 text-left">
      <p className="text-sm font-medium text-gray-900">
        {STOCK_STATUS_LABELS[status]}
      </p>
      <p className="text-xs text-gray-600">{reason}</p>

      {claims.length > 0 ? (
        <div className="rounded border border-gray-200 bg-gray-50 p-2">
          <DetailRow label="Total quantity" value={total} unit={unit} />
          {claims.map((claim) => (
            <DetailRow
              key={claim.label}
              op="−"
              label={claim.label}
              value={claim.value}
              unit={unit}
            />
          ))}
          <DetailRow
            op="="
            label={ASSET_QUANTITY_FIGURE_LABELS.FREE_NOW}
            value={available}
            unit={unit}
            isResult
          />
        </div>
      ) : null}

      {largestUpcomingBooking > 0 ? (
        <p className="text-xs text-gray-500">
          {/* Named when we know it. "Biggest upcoming booking" is accurate and
              useless — the reader still has to go and find which one. */}
          <span className="font-medium text-gray-700">
            {topBooking ? topBooking.name : "Biggest upcoming booking"}
          </span>{" "}
          asks for {withUnit(largestUpcomingBooking)}. Those units are still on
          the shelf, so they are not taken off Free now.
        </p>
      ) : null}

      {showReorderPoint ? (
        <p className="text-xs text-gray-500">
          Reorder point: {withUnit(minQuantity ?? 0)}
        </p>
      ) : null}

      {/*
        The way out. Everything above this line only DESCRIBES the problem, and
        a description you cannot act on is where this column was failing: it
        announced "2 short" and left the reader to go hunting for which booking,
        across which dates, on which page.

        `SHORT` is the only verdict with a single named culprit, so it is the
        only one that gets a link. The others are a stock level, not an event —
        their fix is ordering more or changing the reorder point, neither of
        which is a place we can send someone.
      */}
      {status === "SHORT" && topBooking ? (
        <Link
          to={`/bookings/${topBooking.id}`}
          // Same link treatment as the booking links in the Status hover card
          // (`SliceBookingName`), so the two panels that sit side by side on a
          // row do not use two different styles for the same kind of link.
          className="mt-1 block truncate border-t border-gray-200 pt-2 text-xs text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-500"
          title={topBooking.name}
        >
          Open booking
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Renders one asset's stock verdict, with an optional hover detail.
 *
 * @param props - See {@link StockStatusBadgeProps}.
 * @returns A colored badge, or the shared empty value for INDIVIDUAL assets and
 *   for quantity assets with no reorder point set.
 */
export function StockStatusBadge({ status, breakdown }: StockStatusBadgeProps) {
  if (!status || status === "NO_THRESHOLD") {
    /**
     * The blank cell earns a hover too, when we have the figures: it is the
     * MAJORITY state, and "why is this empty and what would fill it" is the
     * question it provokes. Says how much is free, then how to get a verdict.
     */
    if (status === "NO_THRESHOLD" && breakdown) {
      return (
        <HoverCard openDelay={100} closeDelay={120}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              aria-label="No reorder point set"
              className="cursor-default rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <EmptyTableValue />
            </button>
          </HoverCardTrigger>
          <HoverCardPortal>
            <HoverCardContent className="w-auto max-w-xs p-3">
              <div className="flex flex-col gap-1.5 text-left">
                <p className="text-sm font-medium text-gray-900">
                  No reorder point
                </p>
                <p className="text-xs text-gray-600">
                  {breakdown.available} of {breakdown.total}
                  {breakdown.unitOfMeasure
                    ? ` ${breakdown.unitOfMeasure}`
                    : ""}{" "}
                  available. Set a reorder point and Shelf will flag this asset
                  once it drops to that level.
                </p>
                {breakdown.assetId ? (
                  <Link
                    to={`/assets/${breakdown.assetId}/edit`}
                    className="text-xs text-gray-700 underline decoration-gray-300 underline-offset-2 hover:text-gray-900 hover:decoration-gray-500"
                  >
                    Set a reorder point
                  </Link>
                ) : null}
              </div>
            </HoverCardContent>
          </HoverCardPortal>
        </HoverCard>
      );
    }
    return <EmptyTableValue />;
  }

  const colors = STOCK_STATUS_COLORS[status];
  const badge = (
    <Badge color={colors.bg} textColor={colors.text}>
      {STOCK_STATUS_LABELS[status]}
    </Badge>
  );

  // No figures — the header legend renders badges as a key, and a tooltip
  // inside that tooltip would be unreachable.
  if (!breakdown) {
    return badge;
  }

  /*
    HoverCard, not Tooltip. A Radix tooltip closes the moment the pointer leaves
    its trigger, so a link inside one is unreachable — you can see it and never
    click it. That is not a styling detail: it is why this column could only
    ever describe a problem and never lead anywhere. HoverCard keeps the panel
    open while the pointer travels into it, which is what makes the booking link
    below actually usable.
  */
  return (
    <HoverCard openDelay={100} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`${STOCK_STATUS_LABELS[status]} — show levels`}
          className="cursor-default rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {badge}
        </button>
      </HoverCardTrigger>
      {/*
        Portalled, like every other hover card in this table. Without it the
        panel renders inside the table's stacking context and a neighbouring
        cell paints on top of it — the card looks fine and its link is not
        clickable, which would have quietly defeated the whole point.
      */}
      <HoverCardPortal>
        <HoverCardContent className="w-auto max-w-xs p-3">
          <StockStatusDetail status={status} breakdown={breakdown} />
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}
