import { AssetStatus } from "@prisma/client";
import { userFriendlyAssetStatus } from "~/components/assets/asset-status-badge";
import { operatorsMap } from "~/components/assets/assets-index/advanced-filters/operator-selector";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { parseFilters } from "~/modules/asset/filter-parsing";
import type { Column } from "~/modules/asset-index-settings/helpers";

/**
 * Lookup data for resolving IDs to user-friendly names.
 */
export interface FilterLookupData {
  locations?: Array<{ id: string; name: string }>;
  categories?: Array<{ id: string; name: string }>;
  tags?: Array<{ id: string; name: string }>;
  teamMembers?: Array<{ id: string; name: string }>;
}

/**
 * Parses sortBy parameters from query string.
 * Format: sortBy=name:asc&sortBy=category:desc
 */
function parseSorting(
  query: string
): Array<{ name: string; direction: string }> {
  const params = new URLSearchParams(query);
  const sortByParams = params.getAll("sortBy");

  return sortByParams
    .map((sort) => {
      const [name, direction] = sort.split(":");
      if (name && direction) {
        return { name, direction };
      }
      return null;
    })
    .filter((s): s is { name: string; direction: string } => s !== null);
}

/**
 * Formats sorting options to human-readable text.
 */
function formatSorting(
  sorts: Array<{ name: string; direction: string }>
): string {
  if (sorts.length === 0) return "";

  const sortTexts = sorts.map((sort) => {
    const fieldName = formatFieldName(sort.name);
    const direction = sort.direction === "asc" ? "ascending" : "descending";
    return `${fieldName} (${direction})`;
  });

  return sortTexts.join(", ");
}

/**
 * Formats a query string into a human-readable filter summary.
 * Example: "Status is: Available, Category is: Laptops | Sort: Name (ascending)"
 *
 * Uses the shared parseFilters function for consistency with server parsing.
 *
 * @param query - URL query string with filter parameters
 * @param columns - Column definitions for parsing filters
 * @param lookupData - Optional lookup data for resolving IDs to names
 * @returns Formatted filter summary string
 */
export function formatFilterSummary(
  query: string,
  columns: Column[],
  lookupData?: FilterLookupData
): string {
  if (!query) return "No filters or sorting";

  try {
    // Parse filters
    const filters = parseFilters(query, columns);

    // Parse search query
    const params = new URLSearchParams(query);
    const searchQuery = params.get("s");

    // Parse sorting
    const sorts = parseSorting(query);

    if (filters.length === 0 && sorts.length === 0 && !searchQuery) {
      return "No filters or sorting";
    }

    // Format filters
    const filterSummaries = filters.map((filter: Filter) => {
      const fieldName = formatFieldName(filter.name);
      const operatorText = formatOperator(filter.operator);
      const valueText = formatValue(
        filter.value,
        filter.type,
        filter.operator,
        filter.name,
        lookupData
      );

      // Format: "Field operator: value" with colon after operator
      return `${fieldName} ${operatorText}: ${valueText}`;
    });

    // Combine filters and sorting
    const parts: string[] = [];

    // Add search query first if present
    if (searchQuery) {
      parts.push(`Search: ${searchQuery}`);
    }

    if (filterSummaries.length > 0) {
      parts.push(filterSummaries.join(", "));
    }

    if (sorts.length > 0) {
      const sortText = formatSorting(sorts);
      parts.push(`Sort: ${sortText}`);
    }

    return parts.join(" | ");
  } catch {
    // If parsing fails, return a generic message
    return "Custom filters and sorting";
  }
}

/**
 * Formats a field name to be human-readable.
 * Converts snake_case and camelCase to Title Case.
 */
function formatFieldName(name: string): string {
  // Handle special cases
  const specialCases: Record<string, string> = {
    mainImage: "Image",
    availableToBook: "Available to book",
    customField: "Custom field",
  };

  if (specialCases[name]) return specialCases[name];

  // Convert camelCase or snake_case to Title Case
  return name
    .replace(/([A-Z])/g, " $1") // Add space before capitals
    .replace(/_/g, " ") // Replace underscores with spaces
    .replace(/^./, (str) => str.toUpperCase()) // Capitalize first letter
    .trim();
}

/**
 * Formats an operator to be human-readable.
 * Reuses the existing operatorsMap from operator-selector component.
 */
function formatOperator(operator: string): string {
  // operatorsMap format: { operator: ["symbol", "label"] }
  return operatorsMap[operator as keyof typeof operatorsMap]?.[1] ?? operator;
}

/**
 * Formats a filter value to be human-readable.
 */
function formatValue(
  value: unknown,
  type: string,
  operator: string,
  fieldName: string,
  lookupData?: FilterLookupData
): string {
  // Handle array values
  if (Array.isArray(value)) {
    if (operator === "between" && value.length === 2) {
      return `${formatSingleValue(
        value[0],
        type,
        fieldName,
        lookupData
      )} and ${formatSingleValue(value[1], type, fieldName, lookupData)}`;
    }
    // For multiple values, show count if more than 3
    if (value.length > 3) {
      return `${value.length} items`;
    }
    return value
      .map((v) => formatSingleValue(v, type, fieldName, lookupData))
      .join(", ");
  }

  return formatSingleValue(value, type, fieldName, lookupData);
}

/**
 * Formats a single value based on its type.
 */
function formatSingleValue(
  value: unknown,
  type: string,
  fieldName: string,
  lookupData?: FilterLookupData
): string {
  if (value === null || value === undefined) return "empty";

  // Handle field-specific formatting with lookups
  const valueStr = String(value);

  // Location lookup
  if (fieldName === "location" && lookupData?.locations) {
    const location = lookupData.locations.find((loc) => loc.id === valueStr);
    if (location) return location.name;
  }

  // Category lookup
  if (fieldName === "category" && lookupData?.categories) {
    const category = lookupData.categories.find((cat) => cat.id === valueStr);
    if (category) return category.name;
  }

  // Tag lookup
  if ((fieldName === "tag" || fieldName === "tags") && lookupData?.tags) {
    const tag = lookupData.tags.find((t) => t.id === valueStr);
    if (tag) return tag.name;
  }

  // Team member/custody lookup
  if (
    (fieldName === "custody" || fieldName === "teamMember") &&
    lookupData?.teamMembers
  ) {
    const member = lookupData.teamMembers.find((m) => m.id === valueStr);
    if (member) return member.name;
  }

  // Status enum - use userFriendlyAssetStatus
  if (
    fieldName === "status" &&
    Object.values(AssetStatus).includes(valueStr as AssetStatus)
  ) {
    return userFriendlyAssetStatus(valueStr as AssetStatus);
  }

  // Boolean values
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  // Date values
  if (type === "date" && typeof value === "string") {
    try {
      const date = new Date(value);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return String(value);
    }
  }

  // Number/amount values
  if (type === "number" || type === "amount") {
    return String(value);
  }

  // String values - truncate if too long
  return valueStr.length > 30 ? `${valueStr.slice(0, 30)}...` : valueStr;
}
