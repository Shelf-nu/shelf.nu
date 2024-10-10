import type { Column } from "~/modules/asset-index-settings/helpers";
import type { FilterFieldType } from "./types";

const friendlyFieldTypeNames = {
  string: "Single-line text",
  text: "Multi-line text",
  boolean: "Yes/No",
  date: "Date",
  number: "Number",
  enum: "Option",
  array: "List",
};

export function getFieldType({
  column,
  friendlyName = false,
}: {
  column: Column;
  friendlyName?: boolean;
}) {
  // Handle default fields
  let fieldType: FilterFieldType;
  switch (column.name) {
    case "id":
    case "name":
    case "category":
    case "location":
    case "kit":
    case "custody":
      fieldType = "string";
      break;
    case "status":
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
          default:
            fieldType = "string";
        }
      } else {
        // Default to string if type can't be determined
        fieldType = "string";
      }
  }

  return friendlyName ? friendlyFieldTypeNames[fieldType] : fieldType;
}
