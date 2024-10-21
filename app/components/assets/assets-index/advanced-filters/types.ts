import type { CustomFieldType } from "@prisma/client";

export type FilterOperator =
  | "is"
  | "isNot"
  | "contains"
  | "before"
  | "after"
  | "between"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "in"
  | "containsAll"
  | "containsAny";

export type FilterFieldType =
  | "string"
  | "text"
  | "boolean"
  | "date"
  | "number"
  | "enum"
  | "array"
  | "customField";

export type FilterDefinition = {
  [K in FilterFieldType]: FilterOperator[];
};

export type Filter = {
  name: string;
  type: FilterFieldType | "customField";
  operator: FilterOperator;
  value: any | [any, any];
  fieldType?: CustomFieldType; // Add this for custom fields
};
