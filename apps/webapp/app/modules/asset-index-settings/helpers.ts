import { CustomFieldType } from "@prisma/client";
import { ASSET_QUANTITY_FIGURE_LABELS } from "@shelf/labels";
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
  "minQuantity",
  "type",
  "upcomingBookings",
  "assetModel",
  // Quantity-pool columns. All three are derived per row rather than stored:
  // `available` and `reserved` are aggregates, `stockStatus` is the verdict
  // from `classifyStockStatus` (@shelf/quantity-control). They render empty for
  // INDIVIDUAL assets, exactly as `quantity` already does.
  "available",
  "reserved",
  "stockStatus",
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
  // Renamed from "Quantity": with `available` beside it, the bare word was read
  // as "how many can I use" by three separate customers. Same field, clearer name.
  quantity: "Total quantity",
  minQuantity: "Min quantity",
  // "Free now", not "Available". Three things in this product were called
  // "Available" at once: this column, the `AssetStatus` badge, and the
  // `Available to book` column beside it. Worse, this one is the only one that
  // is time-bound — it means "free on the shelf TODAY", while the neighbouring
  // `Reserved` and `Stock status` describe a FUTURE booking window. Printing a
  // now-figure and a later-figure side by side under interchangeable names
  // produced rows that read as self-contradicting: 10 free, 12 reserved, Short.
  // The word "now" is what makes the contrast legible. The column KEY stays
  // `available`, so saved filters, URLs and stored column configs are unaffected.
  available: ASSET_QUANTITY_FIGURE_LABELS.FREE_NOW,
  reserved: "Reserved",
  stockStatus: "Stock status",
  type: "Tracking method",
  upcomingBookings: "Upcoming Bookings",
  assetModel: "Asset model",
};

export const defaultFields: Column[] = [
  // ORDER IS THE FEATURE. The pool columns sit immediately after `status`:
  // shipped at the end of the list they landed past every custom field,
  // ~3000px off the right edge, and a column you have to hunt for is the
  // problem this set exists to solve.
  //
  // `quantity` (labelled "Total quantity") is visible and sits directly after
  // `available`, because a free count with no denominator is not an answer:
  // "4 pcs" is a crisis at 4-of-5 and a non-event at 4-of-400. The customer
  // who started this asked to see available "also", meaning ALONGSIDE the
  // total — shipping one and hiding the other answers half the question.
  { name: "id", visible: false, position: 0 },
  { name: "sequentialId", visible: true, position: 1 },
  { name: "qrId", visible: true, position: 2 },
  { name: "status", visible: true, position: 3 },
  { name: "available", visible: true, position: 4 },
  { name: "quantity", visible: true, position: 5 },
  { name: "reserved", visible: true, position: 6 },
  { name: "stockStatus", visible: true, position: 7 },
  { name: "description", visible: true, position: 8 },
  { name: "valuation", visible: true, position: 9 },
  { name: "availableToBook", visible: true, position: 10 },
  { name: "createdAt", visible: true, position: 11 },
  { name: "updatedAt", visible: true, position: 12 },
  { name: "category", visible: true, position: 13 },
  { name: "tags", visible: true, position: 14 },
  { name: "location", visible: true, position: 15 },
  { name: "kit", visible: true, position: 16 },
  { name: "custody", visible: true, position: 17 },
  { name: "upcomingReminder", visible: true, position: 18 },
  { name: "actions", visible: true, position: 19 },
  { name: "upcomingBookings", visible: true, position: 20 },
  { name: "type", visible: false, position: 21 },
  { name: "assetModel", visible: false, position: 22 },
  { name: "minQuantity", visible: false, position: 23 },
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
