import type { Prisma } from "@prisma/client";
import { z } from "zod";

export type Column = {
  name: string;
  visible: boolean;
  position: number;
};
// Define the fixed fields
const fixedFields = [
  "id",
  "status",
  "description",
  "valuation",
  "createdAt",
  "category",
  "tags",
  "location",
  "kit",
  "custody",
];

export const columnsLabelsMap: Record<(typeof fixedFields)[number], string> = {
  id: "ID",
  status: "Status",
  description: "Description",
  valuation: "Valuation",
  createdAt: "Created at",
  category: "Category",
  tags: "Tags",
  location: "Location",
  kit: "Kit",
  custody: "Custody",
};

export const defaultFields = [
  { name: "id", visible: true, position: 0 },
  { name: "status", visible: true, position: 1 },
  { name: "description", visible: true, position: 2 },
  { name: "valuation", visible: true, position: 3 },
  { name: "createdAt", visible: true, position: 4 },
  { name: "category", visible: true, position: 5 },
  { name: "tags", visible: true, position: 6 },
  { name: "location", visible: true, position: 7 },
  { name: "kit", visible: true, position: 8 },
  { name: "custody", visible: true, position: 9 },
] as Prisma.JsonArray;

// Function that generates Zod schema
export const generateColumnsSchema = (customFields: string[]) => {
  // Combine fixed and custom fields
  const allFields = [...fixedFields, ...customFields];

  // Ensure we have at least two fields for z.union, otherwise handle single case
  let nameSchema;
  if (allFields.length === 1) {
    nameSchema = z.literal(allFields[0]); // If only one field, use z.literal
  } else if (allFields.length >= 2) {
    nameSchema = z.union(
      allFields.map((field) => z.literal(field)) as [
        z.ZodLiteral<string>,
        z.ZodLiteral<string>,
        ...z.ZodLiteral<string>[],
      ]
    );
  } else {
    throw new Error("There should be at least one field to validate");
  }

  // Create a schema for each column in the array
  const columnSchema = z.object({
    name: nameSchema, // Name must be one of the fixed or custom fields
    visible: z.boolean(), // 'visible' is a boolean
    position: z.number(), // 'position' is a number
  });

  // The final schema is an array of the column schema
  return z.array(columnSchema);
};

export function parseColumnName(name: string) {
  /** For custom fields, strip the CF */
  if (name.startsWith("cf_")) {
    return name.slice(3);
  }

  /** For fixed fields, return the label */
  return columnsLabelsMap[name as keyof typeof columnsLabelsMap];
}
