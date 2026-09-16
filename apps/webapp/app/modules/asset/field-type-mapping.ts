/**
 * Represents how a field should be handled in filtering and queries.
 * This is shared between client and server code.
 */
export type QueryFieldType =
  | "string"
  | "text"
  | "boolean"
  | "date"
  | "number"
  | "enum"
  | "array"
  | "customField";

/**
 * Determines the field type for filtering and query purposes.
 * Used for building queries and formatting filter values.
 *
 * This function is shared between client and server to ensure
 * consistent field type handling across the application.
 *
 * ⚠️ This mirrors `getUIFieldType` in
 * `components/assets/assets-index/advanced-filters/helpers.ts`. The client map
 * drives which operators the filter UI offers; THIS one drives which SQL
 * builder runs. Updating only one is silent: the UI offers the right operators
 * and the query then compiles the wrong branch — a `stockStatus` filter typed
 * as a string emitted `a."stockStatus"` and 500'd with "column does not exist".
 * Change one, change both.
 *
 * Three of the names here are DERIVED, with no matching column on `Asset`:
 * `stockStatus` is a verdict compared against a shared SQL expression by
 * `addEnumFilter`, and `available` / `reserved` are aggregates that
 * `addNumberFilter` maps to the same pool expressions the columns render. They
 * are typed here exactly like stored fields, which is the point — the whole
 * reason Stock status is one enum column is that it then rides the ordinary
 * filter path instead of needing a bespoke URL param.
 *
 * @param fieldName - Name of the field (e.g., "status", "category", "cf_customField")
 * @returns The query field type for the given field name
 */
export function getQueryFieldType(fieldName: string): QueryFieldType {
  // Custom fields are identified by cf_ prefix
  if (fieldName.startsWith("cf_")) {
    return "customField";
  }

  // Map standard field names to their types
  switch (fieldName) {
    case "id":
    case "sequentialId":
    case "title":
    case "qrId":
      return "string";
    case "status":
    case "custody":
    case "category":
    case "location":
    case "kit":
    case "upcomingBookings":
    case "stockStatus":
      return "enum";
    case "description":
      return "text";
    case "valuation":
    case "quantity":
    case "minQuantity":
    case "available":
    case "reserved":
      return "number";
    case "availableToBook":
      return "boolean";
    case "createdAt":
    case "updatedAt":
      return "date";
    case "tags":
      return "array";
    case "type":
    case "assetModel":
      return "enum";
    default:
      return "string";
  }
}
