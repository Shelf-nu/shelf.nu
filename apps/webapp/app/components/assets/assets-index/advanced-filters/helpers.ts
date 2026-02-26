import type { CustomField } from "@prisma/client";
import { useSearchParams } from "~/hooks/search-params";
import type {
  Column,
  ColumnLabelKey,
} from "~/modules/asset-index-settings/helpers";
import { isShelfQrCode } from "~/utils/qr-code";
import type { Filter, FilterFieldType, FilterOperator } from "./schema";
import type { Sort } from "../advanced-asset-index-filters-and-sorting";

/**
 * Represents how a field should be displayed and interacted with in the UI
 */
export type UIFieldType =
  | "string"
  | "text"
  | "boolean"
  | "date"
  | "number"
  | "amount"
  | "enum"
  | "array";
/**
 * Mapping of friendly names for UI display
 */
const uiFieldTypeNames: Record<UIFieldType, string> = {
  string: "Single-line text",
  text: "Multi-line text",
  boolean: "Yes/No",
  date: "Date",
  number: "Number",
  amount: "Amount",
  enum: "Option",
  array: "List",
};

/**
 * Determines how a field should be presented and interacted with in the UI
 * Used for generating appropriate form controls and filter interfaces
 *
 * @param column - Column configuration object
 * @param friendlyName - Whether to return a user-friendly name instead of the technical type
 * @returns The UI field type or its friendly name
 */
export function getUIFieldType({
  column,
  friendlyName = false,
}: {
  column: Column;
  friendlyName?: boolean;
}): string {
  let fieldType: UIFieldType;

  // Determine base field type
  switch (column.name) {
    case "id":
    case "name":
      fieldType = "string";
      break;
    case "custody":
    case "status":
    case "category":
    case "location":
    case "kit":
    case "upcomingBookings":
      fieldType = "enum";
      break;
    case "description":
      fieldType = "text";
      break;
    case "valuation":
      fieldType = "number";
      break;
    case "availableToBook":
      fieldType = "boolean";
      break;
    case "createdAt":
    case "updatedAt":
      fieldType = "date";
      break;
    case "tags":
      fieldType = "array";
      break;
    default:
      // Handle custom fields
      if (column.name.startsWith("cf_")) {
        switch (column.cfType) {
          case "TEXT":
            fieldType = "string";
            break;
          case "MULTILINE_TEXT":
            fieldType = "text";
            break;
          case "BOOLEAN":
            fieldType = "boolean";
            break;
          case "DATE":
            fieldType = "date";
            break;
          case "OPTION":
            fieldType = "enum";
            break;
          case "AMOUNT":
            fieldType = "amount";
            break;
          case "NUMBER":
            fieldType = "number";
            break;
          default:
            fieldType = "string";
        }
      } else {
        fieldType = "string";
      }
  }

  return friendlyName ? uiFieldTypeNames[fieldType] : fieldType;
}
/** Gets the intial filters of the advanced index based on search params
 * @returns intialFilters -{@link Filter, Filter[]}
 */
export function useInitialFilters(columns: Column[]) {
  const [searchParams] = useSearchParams();

  const initialFilters: Filter[] = [];
  searchParams.forEach((value, key) => {
    const column = columns.find((c) => c.name === key);
    if (column) {
      const [operator, filterValue] = value.split(":");

      initialFilters.push({
        name: key,
        operator: operator as FilterOperator,
        value: operator === "between" ? filterValue.split(",") : filterValue, // Split the value if it's a range
        type: getUIFieldType({ column }) as FilterFieldType,
      });
    }
  });
  return initialFilters;
}

// Function to get default value based on field type
export function getDefaultValueForFieldType(
  column: Column,
  customFields: CustomField[] | null // Update the type to allow null
): any {
  if (column.name.startsWith("cf_")) {
    // Find the matching custom field, handle potential null customFields
    const customField = customFields?.find(
      (cf) => `cf_${cf.name}` === column.name
    );

    switch (column.cfType) {
      case "DATE":
        return new Date().toISOString().split("T")[0];
      case "BOOLEAN":
        return true;
      case "OPTION":
        return customField?.options?.[0] || "";
      case "TEXT":
      case "MULTILINE_TEXT":
        return "";
      default:
        return "";
    }
  } else {
    // Handle regular fields
    switch (getUIFieldType({ column })) {
      case "boolean":
        return true;
      case "date":
        return new Date().toISOString().split("T")[0];
      case "number":
        return 0;
      default:
        return "";
    }
  }
}

export const COLUMNS_WITHOUT_FILTER: ColumnLabelKey[] = [
  "actions",
  "upcomingReminder",
];

/**
 * Determines what columns are available based on already used columns and operation type
 * @param columns - All available columns
 * @param usedColumns - Currently used columns (filters or sorts)
 * @param operation - Whether we're filtering or sorting
 * @returns Filtered list of available columns
 */
export function getAvailableColumns(
  columns: Column[],
  usedColumns: Array<Filter | Sort>,
  operation: "filter" | "sort"
) {
  // Get columns that are visible and not already used
  const availableColumns = columns.filter(
    (column) =>
      column.visible &&
      !usedColumns.find((f) => {
        if (operation === "filter" && "isNew" in f) {
          return f.name === column.name && !f.isNew;
        }
        return f.name === column.name;
      })
  );

  // Apply operation-specific filtering
  return availableColumns.filter((column) => {
    // Common exclusions for both operations
    if (!column.visible) return false;

    /**
     * Some columns like `actions` does not support filtering,
     * so we have to skip them to be availableColumns.
     */
    if (COLUMNS_WITHOUT_FILTER.includes(column.name)) {
      return false;
    }

    if (operation === "sort") {
      // Columns that can't be sorted
      const unsortableColumns = ["tags"];
      if (unsortableColumns.includes(column.name)) return false;

      // Custom fields that can't be sorted
      if (column.name.startsWith("cf_")) {
        const unsortableTypes = ["MULTILINE_TEXT"];
        return !unsortableTypes.includes(column.cfType || "");
      }

      return true;
    }

    if (operation === "filter") {
      const unfilterableColumns: string[] = [];
      if (unfilterableColumns.includes(column.name)) return false;

      return true;
    }

    return true;
  });
}

/**
 * Extracts the QR ID from a Shelf QR URL or returns the full value for external QR codes
 *
 * For Shelf QR codes, extracts the ID:
 * - localhost:3000/qr/abc123?hello=world -> abc123
 * - https://shelf.nu/qr/abc123 -> abc123
 * - https://eam.sh/abc123 -> abc123
 * - abc123 -> abc123
 *
 * For external QR codes, returns full value:
 * - https://example.com/product/123 -> https://example.com/product/123
 * - Any other QR content -> original value
 *
 * @param value - The input value (URL or QR ID)
 * @returns The extracted QR ID for Shelf QRs or full value for external QRs
 */
export function extractQrIdFromValue(value: string): string {
  // First check if it's a Shelf QR code
  if (isShelfQrCode(value)) {
    try {
      // Try to parse as URL first
      const url = new URL(value);

      // Remove leading and trailing slashes and split path
      const pathParts = url.pathname.split("/").filter(Boolean);

      // Get the last part of the path (if exists)
      if (pathParts.length > 0) {
        return pathParts[pathParts.length - 1];
      }

      return value;
    } catch (_e) {
      // If URL parsing fails, return original value (raw QR ID case)
      return value;
    }
  }

  // For external QR codes, return the full value
  return value;
}

// isShelfQrCode function moved to ~/utils/qr-code.ts for shared usage
