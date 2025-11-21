import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { getLocationDescendantIds } from "../location/descendants.server";

/**
 * Utilities to adapt advanced location filters. When the user selects the
 * `withinHierarchy` operator we expand the filter so downstream SQL builders can
 * stay unchanged.
 */
function isWithinHierarchyLocationFilter(filter: Filter) {
  return filter.name === "location" && filter.operator === "withinHierarchy";
}

/**
 * Rewrites location filters using `withinHierarchy` into the equivalent
 * `containsAny` filter populated with all descendant location ids. Other filters
 * are returned untouched so callers can treat the array just like their
 * original input.
 */
export async function expandLocationHierarchyFilters({
  filters,
  organizationId,
}: {
  filters: Filter[];
  organizationId: string;
}): Promise<Filter[]> {
  return Promise.all(
    filters.map(async (filter) => {
      if (!isWithinHierarchyLocationFilter(filter)) {
        return filter;
      }

      if (typeof filter.value !== "string" || !filter.value) {
        return filter;
      }

      if (filter.value === "without-location") {
        return { ...filter, operator: "is" };
      }

      const descendantIds = await getLocationDescendantIds({
        organizationId,
        locationId: filter.value,
      });

      return {
        ...filter,
        operator: "containsAny",
        value: descendantIds,
      };
    })
  );
}
