/**
 * Inventory Value Card
 *
 * Home dashboard card showing how many assets have a known value (progress
 * circle) and the workspace's total inventory value in its currency.
 *
 * The card lives in a grid column whose width does not follow the viewport
 * (one third of the row at `xl`, the full row below it), so its layout and the
 * size of the value are driven by the card's own width through CSS container
 * queries, never by viewport breakpoints. Values can be very long in
 * currencies with large nominal amounts (IDR, VND, NOK in the millions), so the
 * number shrinks to fit its box instead of overflowing or wrapping mid-number.
 *
 * @see {@link file://./../../routes/_layout+/home.tsx}
 */
import type { CSSProperties } from "react";
import { Text, ProgressCircle } from "@tremor/react";
import { useLoaderData } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import type { loader } from "~/routes/_layout+/home";
import { formatCurrency } from "~/utils/currency";
import { DashboardEmptyState } from "./empty-state";
import FallbackLoading from "./fallback-loading";

/** Largest font size of the value, used whenever it fits. */
const MAX_VALUE_FONT_SIZE = "1.875rem";

/**
 * Average glyph width of the semibold value text, in `em`. Slightly above the
 * real average of digits, separators and currency letters so the estimate
 * errs towards fitting.
 */
const AVERAGE_GLYPH_WIDTH_EM = 0.62;

/**
 * Returns a CSS `font-size` that lets `text` fit on one line inside its
 * nearest size container, capped at {@link MAX_VALUE_FONT_SIZE}.
 *
 * `100cqi` is the container's inline size, so dividing it by the estimated
 * width of the text in `em` gives the largest font size that still fits.
 *
 * @param text - The formatted value as rendered
 * @returns A CSS `font-size` value
 */
export function getFittedValueFontSize(text: string) {
  const widthInEm = Math.max(text.length, 1) * AVERAGE_GLYPH_WIDTH_EM;
  return `min(${MAX_VALUE_FONT_SIZE}, calc(100cqi / ${widthInEm.toFixed(2)}))`;
}

export default function InventoryValueChart() {
  const { currency, totalAssets, totalValuation, valueKnownAssets, locale } =
    useLoaderData<typeof loader>();

  const formattedValue = formatCurrency({
    value: totalValuation || 0,
    locale,
    currency,
  });

  return (
    <div className="flex h-full min-w-0 flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-gray-900">
          Inventory value
        </span>
      </div>
      {/* Size container: the layout below reacts to the card's width. */}
      <div className="flex flex-1 items-center justify-center p-6 [container-type:inline-size]">
        {valueKnownAssets > 0 ? (
          <div
            data-testid="inventory-value-layout"
            className="flex w-full flex-col items-center gap-6 [@container(min-width:36rem)]:flex-row [@container(min-width:36rem)]:items-end [@container(min-width:36rem)]:justify-evenly"
          >
            <div className="shrink-0">
              <ClientOnly
                fallback={<FallbackLoading className="size-[150px]" />}
              >
                {() => (
                  <ProgressCircle
                    value={(valueKnownAssets / totalAssets) * 100}
                    size="xl"
                    color="orange"
                    className="relative"
                  >
                    <span className="block text-center text-xs font-medium text-gray-600">
                      Value Known <br />
                      <span className="block text-[14px] font-semibold leading-6 text-gray-900">
                        {valueKnownAssets}/{totalAssets} assets
                      </span>
                      {`(${((valueKnownAssets / totalAssets) * 100).toFixed(
                        2
                      )}%)`}
                    </span>
                  </ProgressCircle>
                )}
              </ClientOnly>
            </div>
            {/*
             * Its own size container, so the value's font size follows the
             * width this box actually gets: the full card when stacked, the
             * space beside the circle when side by side.
             */}
            <div className="w-full min-w-0 text-center [container-type:inline-size] [@container(min-width:36rem)]:flex-1 [@container(min-width:36rem)]:text-right">
              <Text className="mb-2 !text-[14px] font-medium text-gray-600">
                Inventory value
              </Text>
              {/*
               * Browsers below container-query support (Safari < 16, Chrome
               * < 105) keep a fixed size: they ignore the @container layout
               * too, so the value always has the full card width there.
               */}
              <p
                data-testid="inventory-value-amount"
                className="mb-3 whitespace-nowrap text-[1.375rem] font-semibold leading-tight text-gray-900 [@supports(font-size:1cqi)]:text-[length:var(--value-font-size)]"
                style={
                  {
                    "--value-font-size": getFittedValueFontSize(formattedValue),
                  } as CSSProperties
                }
                title={formattedValue}
              >
                {formattedValue}
              </p>
            </div>
          </div>
        ) : (
          <DashboardEmptyState
            text="No asset values yet"
            subText="Add valuations to your assets to see your total inventory value here."
            ctaTo="/assets"
            ctaText="Go to assets"
          />
        )}
      </div>
    </div>
  );
}
