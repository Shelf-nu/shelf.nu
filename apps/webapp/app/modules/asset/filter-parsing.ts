import { CustomFieldType } from "@prisma/client";
import type {
  Filter,
  FilterOperator,
} from "~/components/assets/assets-index/advanced-filters/schema";
import { isSafeSqlIdentifier } from "~/utils/sql";
import { getQueryFieldType } from "./field-type-mapping";
import { splitFilterParam } from "./filter-param";
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
      const [operator, filterValue] = splitFilterParam(value);

      // No separator means no value, which is not a filter. `parseFilterValue`
      // takes a string and would read straight off `undefined`; the server's
      // own `validateAdvancedFilterParams` drops these for the same reason.
      if (filterValue === undefined) {
        return;
      }

      // A numeric filter with no readable number is not a filter either. The
      // query casts the column and compares against the value, and an empty or
      // unreadable one becomes `NaN` — or, through `Number("")`, a comparison
      // against zero that looks like a real filter.
      if (
        isNumericFilter(key, column) &&
        !hasReadableNumbers(operator as FilterOperator, filterValue)
      ) {
        return;
      }

      const dbKey = API_TO_DB_FIELD_MAP[key] || key;

      // Non-custom-field names are used in Prisma.raw() as SQL identifiers,
      // so reject names with unsafe characters to prevent SQL syntax errors
      if (!key.startsWith("cf_") && !isSafeSqlIdentifier(dbKey)) {
        return;
      }

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
 * Whether a filter compares a number: a standard numeric column, or an AMOUNT or
 * NUMBER custom field.
 *
 * @param key - The filter's field name as it appears in the URL
 * @param column - The column definition for that field
 * @returns `true` when the filter's value must be a number
 */
function isNumericFilter(key: string, column: Column): boolean {
  if (key.startsWith("cf_")) {
    return (
      column.cfType === CustomFieldType.AMOUNT ||
      column.cfType === CustomFieldType.NUMBER
    );
  }
  return getQueryFieldType(key) === "number";
}

/**
 * Whether a numeric filter's value holds the numbers its operator needs: one,
 * or exactly two for `between`.
 *
 * @param operator - The filter operator
 * @param value - The raw value after the operator separator
 * @returns `true` when every number is present and finite
 */
function hasReadableNumbers(operator: FilterOperator, value: string): boolean {
  const parts = operator === "between" ? value.split(",") : [value];
  if (operator === "between" && parts.length !== 2) {
    return false;
  }
  return parts.every(
    (part) => part.trim() !== "" && Number.isFinite(Number(part))
  );
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
