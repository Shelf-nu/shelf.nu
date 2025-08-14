import { CustomFieldType } from "@prisma/client";
import { z } from "zod";
import { operatorsPerType } from "./operator-selector";

// Define the base enum schemas
export const filterOperatorSchema = z.enum([
  "is",
  "isNot",
  "contains",
  "before",
  "after",
  "between",
  "gt",
  "lt",
  "gte",
  "lte",
  "in",
  "containsAll",
  "containsAny",
  "matchesAny",
  "inDates",
  "excludeAny",
]);

export const filterFieldTypeSchema = z.enum([
  "string",
  "text",
  "boolean",
  "date",
  "number",
  "amount",
  "enum",
  "array",
  "customField",
]);

// Export the inferred types from the schemas
export type FilterOperator = z.infer<typeof filterOperatorSchema>;
export type FilterFieldType = z.infer<typeof filterFieldTypeSchema>;

// Define specific value schemas for different types
const numberBetweenTuple = z.tuple([z.number(), z.number()]);
const numberValue = z.number();
const numberValueSchema = z.union([numberValue, numberBetweenTuple]);

const stringValueSchema = z.string();
const booleanValueSchema = z.boolean();
const arrayValueSchema = z.array(z.string());

// Define the main filter schema
export const filterSchema = z
  .object({
    name: z.string(),
    type: filterFieldTypeSchema,
    operator: filterOperatorSchema,
    value: z.union([
      stringValueSchema,
      numberValueSchema,
      booleanValueSchema,
      arrayValueSchema,
    ]),
    fieldType: z.nativeEnum(CustomFieldType).optional(),
    isNew: z.boolean().optional(),
  })
  .refine(
    (data) => {
      // Validation for number and amount between
      if (
        (data.type === "number" || data.type === "amount") &&
        data.operator === "between"
      ) {
        return (
          Array.isArray(data.value) &&
          data.value.length === 2 &&
          typeof data.value[0] === "number" &&
          typeof data.value[1] === "number"
        );
      }

      // General between validation
      if (data.operator === "between" && Array.isArray(data.value)) {
        const [start, end] = data.value;
        if (start === undefined || end === undefined) return true;
        if (start === "" || end === "") return true;
        if (data.type === "date") {
          const startDate = new Date(start);
          const endDate = new Date(end);
          return !isNaN(startDate.getTime()) && !isNaN(endDate.getTime());
        }
        if (data.type === "number") {
          const startNum =
            typeof start === "string" ? parseFloat(start) : start;
          const endNum = typeof end === "string" ? parseFloat(end) : end;
          return !isNaN(startNum) && !isNaN(endNum);
        }
      }
      return true;
    },
    {
      message: "Invalid filter configuration",
      path: ["value"],
    }
  );

// Export the main Filter type
export type Filter = z.infer<typeof filterSchema>;

// Additional refinement for operator validation
filterSchema.refine(
  (data) => {
    // Handle custom fields
    if (data.type === "customField" && data.fieldType) {
      const customFieldTypeToFilterType: Record<
        CustomFieldType,
        FilterFieldType
      > = {
        TEXT: "string",
        MULTILINE_TEXT: "text",
        BOOLEAN: "boolean",
        DATE: "date",
        OPTION: "enum",
        AMOUNT: "amount",
        NUMBER: "number",
      };
      const filterType = customFieldTypeToFilterType[data.fieldType];
      return operatorsPerType[filterType].includes(data.operator);
    }

    // Handle regular fields
    return operatorsPerType[
      data.type as Exclude<FilterFieldType, "customField">
    ].includes(data.operator);
  },
  {
    message: "Invalid operator for this field type",
    path: ["operator"],
  }
);

// Helper types for value access
export type NumberFilterValue = z.infer<typeof numberValueSchema>;
export type StringFilterValue = z.infer<typeof stringValueSchema>;
export type BooleanFilterValue = z.infer<typeof booleanValueSchema>;
export type ArrayFilterValue = z.infer<typeof arrayValueSchema>;

export type FilterValue<T extends FilterFieldType> = T extends
  | "number"
  | "amount"
  ? NumberFilterValue
  : T extends "string"
  ? StringFilterValue
  : T extends "boolean"
  ? BooleanFilterValue
  : T extends "array"
  ? ArrayFilterValue
  : never;

// Type guard helpers
export function isNumberTuple(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  );
}

// Type utility for filter definition
export type FilterDefinition = {
  [K in FilterFieldType]: FilterOperator[];
};
