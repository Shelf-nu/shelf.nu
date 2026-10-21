/**
 * Asset Model Row
 *
 * One row of the asset index's model view: a model, the number of currently
 * filtered assets carrying it, and how those assets break down by status.
 *
 * Counts are FILTERED counts. A model with twenty assets shows three when the
 * active filters match three of them, which is what makes the view answer
 * "what do I have here", and the list header states it so the number is never
 * read as a workspace total.
 *
 * @see {@link file://./../../../modules/asset-model/rollup.server.ts}
 */
import { memo, useMemo } from "react";
import type { ReactNode } from "react";
import type { Currency } from "@prisma/client";
import type { AssetModelBucket } from "~/modules/asset-model/bucket";
import type { AssetModelRollupRow } from "~/modules/asset-model/rollup.server";
import { BADGE_COLORS } from "~/utils/badge-colors";
import { formatCurrency } from "~/utils/currency";
import { tw } from "~/utils/tw";
import { AssetModelAssetsSheet } from "./asset-model-assets-sheet";
import ImageWithPreview from "../../image-with-preview/image-with-preview";
import { Badge } from "../../shared/badge";
import { Td } from "../../table";
import { CategoryBadge } from "../category-badge";

/**
 * How the bucket of assets carrying no model is named, in the row and in the
 * title of the sheet it opens. One constant so the two cannot drift, and so
 * the name matches the "No model" option the advanced filter offers for the
 * same set.
 */
const NO_MODEL_LABEL = "No model";

/**
 * Where this model's matching assets currently are.
 *
 * A count of asset STATUS, not of what a booking could take. The three values
 * partition the row (`in + out + in custody === assets`), so all three render
 * even at zero: a reader can add them up and get the row's own total.
 *
 * One count per line, unconditionally. The cell sits in a `table-auto` column
 * whose width is decided by the content of every row at once, so a count that
 * shares a line with its neighbour when there is room shares it in some rows
 * and not others, and the eye cannot compare two rows any more. A vertical
 * stack is the same shape whatever width the column is given.
 *
 * Deliberately avoids the word "available". Booking availability is a
 * different number over a booking window, computed as fleet minus custody
 * minus overlapping reservations, and it ignores status entirely: a unit out
 * on a booking that ends before the new window is bookable while sitting in
 * "out" here. The bookable figure belongs in the booking dialog, beside the
 * dates that define it, and `getAssetModelAvailability` is what produces it.
 *
 * `notBookable` is not part of the partition. `availableToBook` is an
 * independent flag that overlaps all three, so it renders as its own badge and
 * is never added into a total.
 */
function StatusSplit({ item }: { item: AssetModelRollupRow }) {
  return (
    <div className="flex flex-col items-start gap-1 text-sm">
      <span className="font-medium text-gray-900">{item.available} in</span>
      <span className="text-gray-500">{item.checkedOut} out</span>
      <span className="text-gray-500">{item.inCustody} in custody</span>
      {item.notBookable > 0 ? (
        <Badge
          color={BADGE_COLORS.orange.bg}
          textColor={BADGE_COLORS.orange.text}
          withDot={false}
        >
          {item.notBookable} not bookable
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * A single rollup row, rendered as the `ItemComponent` of the model view's
 * `List`.
 *
 * Memoised like its sibling row component, `AdvancedAssetRow`: `extraProps`
 * is a caller-supplied object, so a stable reference for it (see
 * `assets-list.tsx`) is what lets this `memo()` actually skip re-rendering
 * rows whose data has not changed.
 *
 * @param item - The rollup row. `assetModelId === null` is the "No model"
 *   bucket, rendered muted. The query sorts it last.
 * @param extraProps.locale - Locale for currency formatting.
 * @param extraProps.currency - Workspace currency code.
 * @param bulkActions - The list's bulk-action toolbar, passed by `List`. Read
 *   only as a signal that a checkbox column precedes this row, which already
 *   supplies the left gutter the name cell would otherwise draw.
 */
export const AssetModelRow = memo(function AssetModelRow({
  item,
  extraProps,
  bulkActions,
}: {
  item: AssetModelRollupRow;
  extraProps?: { locale?: string; currency?: Currency };
  bulkActions?: ReactNode;
}) {
  const isNoModel = item.assetModelId === null;
  const locale = extraProps?.locale ?? "en-US";
  const currency = extraProps?.currency ?? "USD";

  /**
   * The one place a rollup row's nullable model id becomes a bucket. Past this
   * line the drill-down addresses itself through the union, so neither the
   * endpoint nor the "view all" link can be built from a missing id.
   *
   * Memoised because the sheet's link is memoised on it: an object rebuilt on
   * every render would rebuild that link too, defeating this component's own
   * `memo()`.
   */
  const bucket = useMemo<AssetModelBucket>(
    () =>
      item.assetModelId === null
        ? { kind: "unassigned" }
        : { kind: "model", assetModelId: item.assetModelId },
    [item.assetModelId]
  );

  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div
          className={tw(
            "flex items-center gap-3 py-4",
            // Gutter is dropped from `md` up only, matching the kits index:
            // below that the checkbox column is not what supplies the left
            // inset, so removing it pushes the thumbnail against the edge.
            bulkActions ? "md:pl-0 md:pr-6" : "px-6"
          )}
        >
          {isNoModel ? (
            // The dashed outline carries "no image" on its own. A dash
            // character in the slot reads as a value rather than an absence,
            // and the row is already named "No model".
            <div
              aria-hidden
              className="size-12 shrink-0 rounded border border-dashed border-gray-300"
            />
          ) : (
            <ImageWithPreview
              thumbnailUrl={item.thumbnailImage ?? item.image ?? undefined}
              alt={item.name ?? "Asset model"}
              className="size-12 shrink-0 rounded border object-cover"
            />
          )}
          <div className="min-w-0">
            <div
              className={tw(
                "word-break font-medium",
                isNoModel ? "text-gray-500" : "text-gray-900"
              )}
            >
              {isNoModel ? NO_MODEL_LABEL : item.name}
            </div>
            {item.description ? (
              <div className="line-clamp-1 text-sm text-gray-500">
                {item.description}
              </div>
            ) : null}
          </div>
        </div>
      </Td>

      <Td>
        <CategoryBadge
          category={
            item.defaultCategoryId && item.defaultCategoryName
              ? {
                  id: item.defaultCategoryId,
                  name: item.defaultCategoryName,
                  color: item.defaultCategoryColor ?? "#808080",
                }
              : null
          }
        />
      </Td>

      <Td>
        {/* The no-model bucket drills down like every other row. It is where a
            customer starts grouping an existing fleet into models, so it is
            the row that most needs to lead somewhere: open it, select the
            units, then Update asset model. */}
        <AssetModelAssetsSheet
          bucket={bucket}
          title={isNoModel ? NO_MODEL_LABEL : item.name ?? "Asset model"}
          matchingAssets={item.matchingAssets}
        />
      </Td>

      <Td>
        <StatusSplit item={item} />
      </Td>

      <Td>{formatCurrency({ value: item.totalValue, locale, currency })}</Td>
    </>
  );
});
