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
      return "enum";
    case "description":
      return "text";
    case "valuation":
      return "number";
    case "availableToBook":
      return "boolean";
    case "createdAt":
    case "updatedAt":
      return "date";
    case "tags":
      return "array";
    default:
      return "string";
  }
}
