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
  | "array";

export type FilterDefinition = {
  [K in FilterFieldType]: FilterOperator[];
};

export type Filter = {
  name: string;
  type: FilterFieldType;
  operator: FilterOperator;
  value: any | [any, any]; // This could be further refined based on the field type
};
