import { operatorsMap } from "~/components/assets/assets-index/advanced-filters/operator-selector";
import type { Filter } from "~/components/assets/assets-index/advanced-filters/schema";
import { parseFilters } from "~/modules/asset/filter-parsing";
import type { Column } from "~/modules/asset-index-settings/helpers";

/**
 * Formats a query string into a human-readable filter summary.
 * Example: "Status is Available, Category is Laptops"
 *
 * Uses the shared parseFilters function for consistency with server parsing.
 *
 * @param query - URL query string with filter parameters
 * @param columns - Column definitions for parsing filters
 * @returns Formatted filter summary string
 */
export function formatFilterSummary(
  query: string,
  columns: Column[]
): string {
  if (!query) return "No filters";

  try {
    const filters = parseFilters(query, columns);

    if (filters.length === 0) return "No filters";

    const summaries = filters.map((filter: Filter) => {
      const fieldName = formatFieldName(filter.name);
      const operatorText = formatOperator(filter.operator);
      const valueText = formatValue(filter.value, filter.type, filter.operator);

      return `${fieldName} ${operatorText} ${valueText}`;
    });

    return summaries.join(", ");
  } catch {
    // If parsing fails, return a generic message
    return "Custom filters";
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
  operator: string
): string {
  // Handle array values
  if (Array.isArray(value)) {
    if (operator === "between" && value.length === 2) {
      return `${formatSingleValue(value[0], type)} and ${formatSingleValue(value[1], type)}`;
    }
    // For multiple values, show count if more than 3
    if (value.length > 3) {
      return `${value.length} items`;
    }
    return value.map((v) => formatSingleValue(v, type)).join(", ");
  }

  return formatSingleValue(value, type);
}

/**
 * Formats a single value based on its type.
 */
function formatSingleValue(value: unknown, type: string): string {
  if (value === null || value === undefined) return "empty";

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
  const str = String(value);
  return str.length > 30 ? `${str.slice(0, 30)}...` : str;
}
