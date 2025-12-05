import { CustomFieldType } from "@prisma/client";
import type {
  Filter,
  FilterOperator,
} from "~/components/assets/assets-index/advanced-filters/schema";
import { getQueryFieldType } from "./field-type-mapping";
import type { Column } from "../asset-index-settings/helpers";

/**
 * Mapping of API field names to database column names.
 * Used to translate field names before building database queries.
 */
const API_TO_DB_FIELD_MAP: Record<string, string> = {
  valuation: "value",
};

/**
 * Parses a filter query string into an array of Filter objects.
 * This function is shared between client and server code.
 *
 * Expected format: `key=operator:value`
 * Example: `status=is:AVAILABLE&category=is:laptop-123`
 *
 * @param filtersString - URL query string with filter parameters
 * @param columns - Column definitions for parsing filters
 * @returns Array of parsed Filter objects
 */
export function parseFilters(
  filtersString: string,
  columns: Column[]
): Filter[] {
  const searchParams = new URLSearchParams(filtersString);
  const filters: Filter[] = [];

  searchParams.forEach((value, key) => {
    const column = columns.find((c) => c.name === key);
    if (column) {
      const [operator, filterValue] = value.split(":");
      const dbKey = API_TO_DB_FIELD_MAP[key] || key;

      const filter: Filter = {
        name: dbKey,
        type: key.startsWith("cf_") ? "customField" : getQueryFieldType(key),
        operator: operator as FilterOperator,
        value: parseFilterValue(
          key,
          operator as FilterOperator,
          filterValue,
          columns
        ),
        fieldType: column.cfType,
      };
      filters.push(filter);
    }
  });

  return filters;
}

/**
 * Parses a filter value based on the field type and operator.
 * Handles type conversion for numbers, booleans, dates, and arrays.
 *
 * @param field - The name of the field being filtered
 * @param operator - The filter operator being used
 * @param value - The raw filter value as a string
 * @param columns - Column definitions for custom field type lookup
 * @returns The parsed value in the appropriate type
 */
function parseFilterValue(
  field: string,
  operator: FilterOperator,
  value: string,
  columns: Column[]
): any {
  // Handle custom fields
  if (field.startsWith("cf_")) {
    const column = columns.find((c) => c.name === field);
    if (column && column.cfType) {
      switch (column.cfType) {
        case CustomFieldType.BOOLEAN:
          return value.toLowerCase() === "true";
        case CustomFieldType.DATE:
        case CustomFieldType.AMOUNT:
        case CustomFieldType.NUMBER:
          return operator === "between" ? value.split(",") : value;
        default:
          return value;
      }
    }
  }

  // Handle standard fields
  switch (getQueryFieldType(field)) {
    case "number":
      return operator === "between"
        ? value.split(",").map(Number)
        : Number(value);
    case "boolean":
      return value.toLowerCase() === "true";
    case "date":
      return operator === "between" ? value.split(",") : value;
    case "enum":
      return operator === "in" ? value.split(",") : value;
    case "string":
    case "text":
      // For matchesAny and containsAny, keep as comma-separated string
      return value;
    default:
      return value;
  }
}
