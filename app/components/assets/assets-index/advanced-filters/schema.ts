import { AssetStatus } from "@prisma/client";
import { z } from "zod";
import { operatorsPerType } from "./operator-selector";

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

const filterOperatorSchema = z.enum([
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
]);

const filterFieldTypeSchema = z.enum([
  "string",
  "text",
  "boolean",
  "date",
  "number",
  "enum",
  "array",
]);

export const filterSchema = z
  .object({
    name: z.string(),
    type: filterFieldTypeSchema,
    operator: filterOperatorSchema,
    value: z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.array(z.string().optional()),
    ]),
  })
  .refine(
    (data) => {
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
          const startNum = parseFloat(start);
          const endNum = parseFloat(end);
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

export type Filter = z.infer<typeof filterSchema>;

// Additional refinement to check if the operator is valid for the field type
filterSchema.refine(
  (data) =>
    operatorsPerType[data.type].includes(data.operator as FilterOperator),
  {
    message: "Invalid operator for this field type",
    path: ["operator"],
  }
);
