import { CustomFieldType } from "@prisma/client";
import { z } from "zod";

export type Column = {
  name: ColumnLabelKey;
  visible: boolean;
  position: number;
  cfType?: CustomFieldType;
};
/**
 * Brings one custom field's column in a single settings row into step with the
 * field, returning the updated column list.
 *
 * Every settings row in the organization is reconciled separately — there is
 * one per user — and a row is not obliged to have a column for the field.
 * A row written before the field existed does not, and `validateColumns` only
 * re-adds the FIXED columns on read, never custom-field ones. So "there is no
 * column here" is an ordinary state, and on deactivation it means there is
 * nothing to do.
 *
 * That case is the trap this function exists to contain. `findIndex` reports a
 * miss as `-1`, and `-1` is a perfectly valid `splice` start index — it counts
 * from the end — so a removal aimed at an absent column silently takes the LAST
 * column instead. The row then loses a column that has nothing to do with the
 * field: a fixed one returns on the next read but reset to the static default,
 * losing whatever the user had chosen for it, and a custom-field one does not
 * return at all.
 *
 * @param columns - The row's current columns; not modified
 * @param field.oldName - The field's name BEFORE this change, which is what the
 *   existing column is keyed on
 * @param field.newName - The field's name after it, used for the column it
 *   keeps or gains
 * @param field.active - Whether the field is active after this change
 * @param field.cfType - The field's type, recorded on the column
 * @returns A new column list reflecting the change
 */
export function syncCustomFieldColumn(
  columns: Column[],
  {
    oldName,
    newName,
    active,
    cfType,
  }: {
    oldName: string;
    newName: string;
    active: boolean;
    cfType?: CustomFieldType;
  }
): Column[] {
  const next = [...columns];
  const index = next.findIndex((col) => col?.name === `cf_${oldName}`);

  if (!active) {
    // Absent is not an error, and it is emphatically not "remove the last one".
    return index === -1 ? next : next.filter((_, i) => i !== index);
  }

  const name = `cf_${newName}` as Column["name"];

  if (index === -1) {
    const highestPosition = next.reduce(
      (acc, col) => (col.position > acc ? col.position : acc),
      0
    );
    next.push({ name, visible: true, position: highestPosition + 1, cfType });
    return next;
  }

  // The column is the user's: they chose whether to show it and where to put
  // it, and reactivating or renaming the field is not a reason to override that.
  next[index] = {
    name,
    visible: next[index].visible,
    position: next[index].position,
    cfType,
  };
  return next;
}

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
  "quantity",
  "unitOfMeasure",
  "minQuantity",
  "type",
  "upcomingBookings",
  "assetModel",
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
//
// `total_value` is **export-only** — emitted as a synthetic column in the
// CSV export (`buildCsvExportDataFromAssets`) so users get a round-trip-safe
// per-unit `valuation` AND the qty-aware total side by side. It's
// intentionally NOT in `fixedFields` / `defaultFields` / the column-picker
// schema (`generateColumnsSchema`), so it never appears in user column
// settings or the UI's "manage columns" picker. Including it here keeps
// the type system honest when the export caller injects it.
export type ColumnLabelKey =
  | FixedField
  | BarcodeField
  | "name"
  | "total_value"
  | CustomFieldColumnKey;

export const columnsLabelsMap: { [key in ColumnLabelKey]: string } = {
  id: "ID",
  sequentialId: "Asset ID",
  qrId: "QR ID",
  name: "Name",
  status: "Status",
  description: "Description",
  valuation: "Value",
  // Export-only synthetic column (see `ColumnLabelKey` comment above).
  total_value: "Total value",
  availableToBook: "Available to book",
  createdAt: "Created at",
  updatedAt: "Updated at",
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
  quantity: "Quantity",
  unitOfMeasure: "Unit of measure",
  minQuantity: "Min quantity",
  type: "Tracking method",
  upcomingBookings: "Upcoming Bookings",
  assetModel: "Asset model",
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
  { name: "quantity", visible: false, position: 17 },
  { name: "unitOfMeasure", visible: false, position: 18 },
  { name: "type", visible: false, position: 19 },
  { name: "assetModel", visible: false, position: 20 },
  { name: "minQuantity", visible: false, position: 21 },
];

/**
 * Default columns that belong right after another column, keyed by the column
 * they follow. The Quantity cell holds only the number and the unit lives in
 * `unitOfMeasure`, so the unit column sits next to Quantity and is shown
 * whenever Quantity is.
 */
const followsColumn: Partial<Record<ColumnLabelKey, ColumnLabelKey>> = {
  unitOfMeasure: "quantity",
};

/**
 * Adds default columns that a saved column set lacks.
 *
 * Settings rows are per user and outlive the default list, so a fixed column
 * added to `defaultFields` is missing from every row saved before it existed.
 * Each missing column is inserted and every saved column at or after its
 * position moves down by one, so the user's own order is kept.
 *
 * - A column listed in {@link followsColumn} goes right after the column it
 *   follows, wherever the saved set has that column, and is shown when that
 *   column is shown. Adding it never separates it from its partner or hides
 *   what the user already saw.
 * - Any other column goes in at the position a fresh row would give it, with
 *   its default visibility.
 *
 * @param columns - The row's saved columns; not modified
 * @param missing - Names of the default columns to add
 * @returns A new column list with the missing default columns inserted
 */
export function insertMissingDefaultColumns(
  columns: Column[],
  missing: ColumnLabelKey[]
): Column[] {
  // Ascending default order, so a column that follows another is inserted
  // after it when both are missing.
  const toInsert = defaultFields
    .filter((field) => missing.includes(field.name))
    .sort((a, b) => a.position - b.position);

  return toInsert.reduce<Column[]>(
    (acc, field) => {
      const partnerName = followsColumn[field.name];
      const partner = partnerName
        ? acc.find((col) => col.name === partnerName)
        : undefined;
      const position = partner ? partner.position + 1 : field.position;

      return [
        ...acc.map((col) =>
          col.position >= position
            ? { ...col, position: col.position + 1 }
            : col
        ),
        {
          ...field,
          position,
          visible: field.visible || Boolean(partner?.visible),
        },
      ];
    },
    [...columns]
  );
}

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
