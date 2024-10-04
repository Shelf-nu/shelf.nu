import type { CustomFieldType, Prisma } from "@prisma/client";
import { z } from "zod";
import type { CustomFieldSorting } from "../asset/types";

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
    // cfType: z.optional(z.enum())
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

export function parseSortingOptions(sortBy: string[]): {
  orderByClause: string;
  customFieldSortings: CustomFieldSorting[];
} {
  const fields = sortBy.map((s) => {
    const [name, direction] = s.split(":");
    return { name, direction } as { name: string; direction: "asc" | "desc" };
  });

  const orderByParts: string[] = [];
  const customFieldSortings: CustomFieldSorting[] = [];

  const directAssetFields = ["id", "status", "description", "createdAt"];

  for (const field of fields) {
    if (field.name === "name") {
      orderByParts.push(`a."title" ${field.direction}`);
    } else if (field.name === "valuation") {
      orderByParts.push(`a."value" ${field.direction}`);
    } else if (directAssetFields.includes(field.name)) {
      orderByParts.push(`a."${field.name}" ${field.direction}`);
    } else if (field.name === "kit") {
      orderByParts.push(`k."name" ${field.direction}`);
    } else if (field.name === "category") {
      orderByParts.push(`c."name" ${field.direction}`);
    } else if (field.name === "location") {
      orderByParts.push(`l."name" ${field.direction}`);
    } else if (field.name === "custody") {
      orderByParts.push(
        `COALESCE(tm.name, CONCAT(bu."firstName", ' ', bu."lastName"), btm.name) ${field.direction}`
      );
    } else if (field.name.startsWith("cf_")) {
      const customFieldName = field.name.slice(3); // Remove 'cf_' prefix
      const alias = `cf_${customFieldName.replace(/\s+/g, "_")}`;
      customFieldSortings.push({
        name: customFieldName,
        valueKey: "raw", // Assuming 'raw' is always the key for the sortable value
        alias,
      });
      orderByParts.push(`${alias} ${field.direction}`);
    } else {
      console.warn(`Unknown sort field: ${field.name}`);
    }
  }

  const orderByClause =
    orderByParts.length > 0 ? `ORDER BY ${orderByParts.join(", ")}` : "";

  return { orderByClause, customFieldSortings };
}
