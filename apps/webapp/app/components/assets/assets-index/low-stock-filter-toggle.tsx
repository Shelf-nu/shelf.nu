/**
 * Low Stock Filter Toggle
 *
 * A single-button quick filter for the assets index (ADVANCED mode only)
 * that restricts the list to QUANTITY_TRACKED assets at/below their reorder
 * threshold (`Asset.minQuantity`).
 *
 * Plumbing mirrors {@link AvailabilityViewToggle} (`./view-toggle`): a plain
 * `lowStockOnly=true` URL search param toggled client-side via
 * `useSearchParams`, read server-side in `getAdvancedPaginatedAndFilterableAssets`
 * and gated inside `generateWhereClause`'s `lowStockOnly` param
 * (`~/modules/asset/query.server`).
 *
 * @see {@link file://../../../modules/asset/query.server.ts} for the WHERE fragment
 */
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { tw } from "~/utils/tw";

/**
 * Renders a toggle button that turns the "Low stock" quick filter on/off by
 * setting/removing the `lowStockOnly` search param.
 */
export function LowStockFilterToggle() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isActive = searchParams.get("lowStockOnly") === "true";

  return (
    <Button
      type="button"
      variant="secondary"
      className={tw(
        "whitespace-nowrap font-normal text-gray-600",
        isActive ? "border-primary bg-primary-25 text-primary" : ""
      )}
      aria-pressed={isActive}
      onClick={() => {
        setSearchParams((prev) => {
          const newParams = new URLSearchParams(prev);
          if (isActive) {
            newParams.delete("lowStockOnly");
          } else {
            newParams.set("lowStockOnly", "true");
          }
          // Re-run pagination from the top when the filter changes.
          newParams.delete("page");
          return newParams;
        });
      }}
    >
      Low stock
    </Button>
  );
}
