/**
 * Asset Model Row
 *
 * One row of the asset index's model view: a model, the number of currently
 * filtered assets carrying it, and how those assets break down by status.
 *
 * Counts are FILTERED counts. A model with twenty assets shows three when the
 * active filters match three of them — that is what makes the view answer
 * "what do I have here", and the list header states it so the number is never
 * read as a workspace total.
 *
 * @see {@link file://./../../../modules/asset-model/rollup.server.ts}
 */
import { memo } from "react";
import type { Currency } from "@prisma/client";
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
 * Renders the status split so a reader can see the pool at a glance.
 *
 * `available + checkedOut + inCustody` is the whole `AssetStatus` partition —
 * `notBookable` is an independent `availableToBook` flag that overlaps all
 * three, so it renders as its own chip and is never folded into a total.
 */
function AvailabilitySplit({ item }: { item: AssetModelRollupRow }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="font-medium text-gray-900">
        {item.available} available
      </span>
      {item.checkedOut > 0 ? (
        <span className="text-gray-500">{item.checkedOut} checked out</span>
      ) : null}
      {item.inCustody > 0 ? (
        <span className="text-gray-500">{item.inCustody} in custody</span>
      ) : null}
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
 *   bucket, rendered muted — the query sorts it last.
 * @param extraProps.locale - Locale for currency formatting.
 * @param extraProps.currency - Workspace currency code.
 */
export const AssetModelRow = memo(function AssetModelRow({
  item,
  extraProps,
}: {
  item: AssetModelRollupRow;
  extraProps?: { locale?: string; currency?: Currency };
}) {
  const isNoModel = item.assetModelId === null;
  const locale = extraProps?.locale ?? "en-US";
  const currency = extraProps?.currency ?? "USD";

  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex items-center gap-3 px-6 py-4">
          {isNoModel ? (
            <div className="flex size-14 shrink-0 items-center justify-center rounded border border-dashed border-gray-300 text-gray-400">
              —
            </div>
          ) : (
            <ImageWithPreview
              thumbnailUrl={item.thumbnailImage ?? item.image ?? undefined}
              alt={item.name ?? "Asset model"}
              className="size-14 shrink-0 rounded border object-cover"
            />
          )}
          <div className="min-w-0">
            <div
              className={tw(
                "word-break font-medium",
                isNoModel ? "text-gray-500" : "text-gray-900"
              )}
            >
              {isNoModel ? "No model" : item.name}
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
        {isNoModel ? (
          <span className="text-gray-500">
            {item.matchingAssets}{" "}
            {item.matchingAssets === 1 ? "asset" : "assets"}
          </span>
        ) : (
          <AssetModelAssetsSheet
            assetModelId={item.assetModelId as string}
            modelName={item.name ?? "Asset model"}
            matchingAssets={item.matchingAssets}
          />
        )}
      </Td>

      <Td>
        <AvailabilitySplit item={item} />
      </Td>

      <Td>{formatCurrency({ value: item.totalValue, locale, currency })}</Td>
    </>
  );
});
