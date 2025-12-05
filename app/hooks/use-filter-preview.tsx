import { useMemo } from "react";
import { useLoaderData } from "react-router";

import {
  formatFilterSummary,
  type FilterLookupData,
} from "~/modules/asset-filter-presets/format-filter-summary";
import type { Column } from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

/**
 * Hook to get filter lookup data and helpers for formatting filter previews.
 * Returns raw lookup data, a formatted preview component, and a function to format multiple items.
 *
 * Usage:
 * - For single items (e.g., dialog): const { preview } = useFilterPreview({ query, columns });
 * - For lists: const { formatPreview } = useFilterPreview(); // then call formatPreview(query, columns) for each item
 * - For raw data access: const { lookupData } = useFilterPreview();
 */
export function useFilterPreview(options?: {
  query?: string;
  columns?: Column[];
}) {
  const loaderData = useLoaderData<AssetIndexLoaderData>();
  const {
    locations = [],
    categories = [],
    tags = [],
    teamMembers = [],
  } = loaderData;

  // Generate lookup data from loader
  const lookupData: FilterLookupData = useMemo(
    () => ({
      locations: locations.map((loc) => ({ id: loc.id, name: loc.name })),
      categories: categories.map((cat) => ({ id: cat.id, name: cat.name })),
      tags: tags.map((tag) => ({ id: tag.id, name: tag.name })),
      teamMembers: teamMembers.map((tm) => ({ id: tm.id, name: tm.name })),
    }),
    [locations, categories, tags, teamMembers]
  );

  /**
   * Formats a filter summary string into a component with bold values.
   * Internal helper used by both preview and formatPreview.
   */
  const formatSummaryComponent = useMemo(() => {
    function FormatSummary(
      query: string,
      columns: Column[],
      className = "text-sm text-gray-700"
    ) {
      let summary: string;
      try {
        summary = formatFilterSummary(query, columns, lookupData);
      } catch (_error) {
        summary = "Unable to preview filters and sorting";
      }

      return (
        <div className={className}>
          {summary.split(" | ").map((section, sectionIndex, sections) => 
            // Each section is either filters or sorting
            // Filters: "Field operator: value, Field operator: value"
            // Sorting: "Sort: Name (ascending), Category (descending)"
            
             (
              <span key={sectionIndex}>
                {section.split(", ").map((part, index, array) => {
                  const colonIndex = part.lastIndexOf(": ");
                  if (colonIndex === -1) {
                    return (
                      <span key={`${sectionIndex}-${index}`}>
                        {part}
                        {index < array.length - 1 && ", "}
                      </span>
                    );
                  }

                  const prefix = part.substring(0, colonIndex + 1);
                  const value = part.substring(colonIndex + 2);

                  return (
                    <span key={`${sectionIndex}-${index}`}>
                      {prefix}{" "}
                      <strong className="font-semibold text-gray-700">
                        {value}
                      </strong>
                      {index < array.length - 1 && ", "}
                    </span>
                  );
                })}
                {sectionIndex < sections.length - 1 && (
                  <span className="mx-1">|</span>
                )}
              </span>
            )
          )}
        </div>
      );
    }
    return FormatSummary;
  }, [lookupData]);

  // If query and columns are provided, generate the preview component
  const preview = useMemo(() => {
    if (!options?.query || !options?.columns) {
      return null;
    }

    if (!options.query) {
      return (
        <div className="text-sm text-gray-700">
          No active filters or sorting
        </div>
      );
    }

    return formatSummaryComponent(
      options.query,
      options.columns,
      "text-sm text-gray-700"
    );
  }, [options?.query, options?.columns, formatSummaryComponent]);

  /**
   * Function to format a filter preview for list items.
   * Use this when rendering multiple presets to avoid re-invoking the hook.
   */
  const formatPreview = useMemo(
    () => (query: string, columns: Column[]) =>
      formatSummaryComponent(query, columns, "truncate text-xs text-gray-500"),
    [formatSummaryComponent]
  );

  return { lookupData, preview, formatPreview };
}
