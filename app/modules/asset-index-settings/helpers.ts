import type { Prisma } from "@prisma/client";
import { CustomFieldType } from "@prisma/client";
import { z } from "zod";

export type Column = {
  name: string;
  visible: boolean;
  position: number;
  /** Optionally for custom fields add the type */
  cfType?: CustomFieldType;
};
// Define the fixed fields
export const fixedFields = [
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
  name: "Name",
  status: "Status",
  description: "Description",
  valuation: "Value",
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
  const allFields = [...fixedFields, ...customFields] as const;

  // Ensure we have at least one field for z.union or z.literal
  let nameSchema;
  if (allFields.length === 1) {
    nameSchema = z.literal(allFields[0]); // Single field case
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

  // Create a Zod schema for each column object
  const columnSchema = z.object({
    name: nameSchema, // Name must be one of the fixed or custom fields
    visible: z
      .union([z.boolean(), z.string()])
      .transform((val) => val === "on" || val === true) // Convert "on" to boolean true
      .default(false), // if not present in the formData, convert to false. That means the checkbox was unselected
    position: z.union([z.string(), z.number()]).transform(Number), // Ensure position is a number
    cfType: z.nativeEnum(CustomFieldType).optional(), // Optionally validate custom field type
  });

  // Return the final schema
  return z.object({
    intent: z.literal("changeColumns"), // Validate intent is 'changeColumns'
    columns: z.array(columnSchema), // Dynamically validate columns as a array of objects
  });
};

export function parseColumnName(name: string) {
  /** For custom fields, strip the CF */
  if (name.startsWith("cf_")) {
    return name.slice(3);
  }

  /** For fixed fields, return the label */
  return columnsLabelsMap[name as keyof typeof columnsLabelsMap];
}
