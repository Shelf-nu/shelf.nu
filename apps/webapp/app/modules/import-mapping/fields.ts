/**
 * Import mapping: the Shelf fields a spreadsheet column can map to.
 *
 * Client-safe on purpose: the mapping review dropdown renders this list, so it
 * cannot import `ASSET_CSV_HEADERS` from the server-only asset utils. The two
 * lists must name the same headers (minus `id`, which the create importer
 * accepts but never reads); `fields.test.ts` fails when they drift.
 *
 * @see {@link file://./../asset/utils.server.ts} `ASSET_CSV_HEADERS`
 * @see {@link file://./heuristics.ts} the rule-based matcher
 */

/** One importable Shelf field, as the mapping review shows it. */
export type ImportField = {
  /** The exact CSV header the importer reads. */
  name: string;
  /** Plain-language name shown in the dropdown. */
  label: string;
  /** One-line hint about the values the importer accepts. */
  hint: string;
  /** Barcode columns need the barcode add-on. */
  requiresBarcodes?: boolean;
};

/**
 * Every header the create importer reads, in dropdown order.
 * `name` values must match `ASSET_CSV_HEADERS` exactly (case-sensitive).
 */
export const IMPORT_FIELDS = [
  { name: "title", label: "Title", hint: "The asset name" },
  { name: "description", label: "Description", hint: "Free text" },
  {
    name: "category",
    label: "Category",
    hint: "Category name, created if missing",
  },
  {
    name: "location",
    label: "Location",
    hint: "Location name, created if missing",
  },
  {
    name: "custodian",
    label: "Custodian",
    hint: "Person holding the asset, created if missing",
  },
  {
    name: "tags",
    label: "Tags",
    hint: "Comma-separated tag names, created if missing",
  },
  { name: "kit", label: "Kit", hint: "Kit name, created if missing" },
  {
    name: "valuation",
    label: "Value",
    hint: "A number without currency symbols",
  },
  {
    name: "bookable",
    label: "Available for bookings",
    hint: "no turns bookings off, anything else keeps them on",
  },
  {
    name: "imageUrl",
    label: "Image URL",
    hint: "A public link to a picture",
  },
  {
    name: "assetModel",
    label: "Asset model",
    hint: "Model name, created if missing",
  },
  {
    name: "qrId",
    label: "Shelf QR ID",
    hint: "An existing, unlinked Shelf QR code",
  },
  {
    name: "type",
    label: "Asset type",
    hint: "INDIVIDUAL or QUANTITY_TRACKED",
  },
  {
    name: "quantity",
    label: "Quantity",
    hint: "Whole number; above 1 needs type QUANTITY_TRACKED",
  },
  {
    name: "minQuantity",
    label: "Low-stock alert at",
    hint: "Whole number, quantity-tracked assets only",
  },
  {
    name: "unitOfMeasure",
    label: "Unit of measure",
    hint: "For example boxes, liters, kg",
  },
  {
    name: "consumptionType",
    label: "Consumption type",
    hint: "ONE_WAY or TWO_WAY, quantity-tracked assets only",
  },
  {
    name: "barcode_Code128",
    label: "Barcode (Code 128)",
    hint: "4 to 40 characters",
    requiresBarcodes: true,
  },
  {
    name: "barcode_Code39",
    label: "Barcode (Code 39)",
    hint: "4 to 43 letters and numbers",
    requiresBarcodes: true,
  },
  {
    name: "barcode_DataMatrix",
    label: "Barcode (DataMatrix)",
    hint: "4 to 100 letters and numbers",
    requiresBarcodes: true,
  },
  {
    name: "barcode_ExternalQR",
    label: "Barcode (external QR)",
    hint: "Any text or URL from an existing QR sticker",
    requiresBarcodes: true,
  },
  {
    name: "barcode_EAN13",
    label: "Barcode (EAN-13)",
    hint: "13 digits",
    requiresBarcodes: true,
  },
] as const satisfies readonly ImportField[];

/** A header the create importer reads, as a type. */
export type AssetCsvHeader = (typeof IMPORT_FIELDS)[number]["name"];

/** All importable header names, for Zod enums and membership checks. */
export const IMPORT_FIELD_NAMES = IMPORT_FIELDS.map((field) => field.name) as [
  AssetCsvHeader,
  ...AssetCsvHeader[],
];

const IMPORT_FIELD_NAME_SET = new Set<string>(IMPORT_FIELD_NAMES);

/**
 * Narrows a string to a header the create importer reads.
 *
 * @param name - Candidate header, compared case-sensitively
 * @returns Whether `name` is an importable Shelf field
 */
export function isAssetCsvHeader(name: string): name is AssetCsvHeader {
  return IMPORT_FIELD_NAME_SET.has(name);
}

/**
 * Looks up the dropdown entry for a header.
 *
 * @param name - An importable header
 * @returns The field's label and hint
 */
export function getImportField(name: AssetCsvHeader): ImportField {
  return IMPORT_FIELDS.find((field) => field.name === name) as ImportField;
}
