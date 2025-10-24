import { CustomFieldType } from "@prisma/client";
import { z } from "zod";

export type Column = {
  name: ColumnLabelKey;
  visible: boolean;
  position: number;
  cfType?: CustomFieldType;
};
// Define the fixed fields
export const fixedFields = [
  "id",
  "sequentialId",
  "qrId",
  "status",
  "description",
  "valuation",
  "availableToBook",
  "createdAt",
  "updatedAt",
  "category",
  "tags",
  "location",
  "kit",
  "custody",
  "upcomingReminder",
  "actions",
  "upcomingBookings",
] as const;

// Define barcode field names
export const barcodeFields = [
  "barcode_Code128",
  "barcode_Code39",
  "barcode_DataMatrix",
  "barcode_ExternalQR",
  "barcode_EAN13",
] as const;

export type BarcodeField = (typeof barcodeFields)[number];

export type FixedField = (typeof fixedFields)[number];

// Define a type for custom fields column names that start with "cf_"
type CustomFieldColumnKey = `cf_${string}`;

// Define a new type that includes both FixedField, BarcodeField and the additional key "name"
export type ColumnLabelKey =
  | FixedField
  | BarcodeField
  | "name"
  | CustomFieldColumnKey;

export const columnsLabelsMap: { [key in ColumnLabelKey]: string } = {
  id: "ID",
  sequentialId: "Asset ID",
  qrId: "QR ID",
  name: "Name",
  status: "Status",
  description: "Description",
  valuation: "Value",
  availableToBook: "Available to book",
  createdAt: "Created at",
  updatedAt: "Last updated at",
  category: "Category",
  tags: "Tags",
  location: "Location",
  kit: "Kit",
  custody: "Custody",
  upcomingReminder: "Upcoming Reminder",
  actions: "Actions",
  barcode_Code128: "Code128",
  barcode_Code39: "Code39",
  barcode_DataMatrix: "DataMatrix",
  barcode_ExternalQR: "External QR",
  barcode_EAN13: "EAN-13",
  upcomingBookings: "Upcoming Bookings",
};

export const defaultFields: Column[] = [
  { name: "id", visible: false, position: 0 },
  { name: "sequentialId", visible: true, position: 1 },
  { name: "qrId", visible: true, position: 2 },
  { name: "status", visible: true, position: 3 },
  { name: "description", visible: true, position: 4 },
  { name: "valuation", visible: true, position: 5 },
  { name: "availableToBook", visible: true, position: 6 },
  { name: "createdAt", visible: true, position: 7 },
  { name: "updatedAt", visible: true, position: 8 },
  { name: "category", visible: true, position: 9 },
  { name: "tags", visible: true, position: 10 },
  { name: "location", visible: true, position: 11 },
  { name: "kit", visible: true, position: 12 },
  { name: "custody", visible: true, position: 13 },
  { name: "upcomingReminder", visible: true, position: 14 },
  { name: "actions", visible: true, position: 15 },
  { name: "upcomingBookings", visible: true, position: 16 },
];

// Generate barcode columns when barcodes are enabled
export const generateBarcodeColumns = (): Column[] =>
  barcodeFields.map((field, index) => ({
    name: field,
    visible: true,
    position: defaultFields.length + index, // Position after fixed fields
  }));

export const generateColumnsSchema = (customFields: string[]) => {
  // Combine fixed, barcode and custom fields to form ColumnLabelKey
  const allFields = [
    ...fixedFields,
    ...barcodeFields,
    "name", // Explicitly include "name"
    ...customFields,
  ] as const;

  // Create a union type of all possible field names
  const nameSchema = z.enum(allFields);

  /**
   * Schema for validating individual column structure
   * This is the source of truth for column validation
   */
  const columnSchema = z.object({
    name: nameSchema,
    visible: z
      .union([z.boolean(), z.literal("on")])
      .transform((val) => val === true || val === "on")
      .default(false),
    position: z.union([z.string(), z.number()]).transform(Number),
    cfType: z.nativeEnum(CustomFieldType).optional(),
  });

  return z.object({
    intent: z.literal("changeColumns"),
    columns: z.array(columnSchema),
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
