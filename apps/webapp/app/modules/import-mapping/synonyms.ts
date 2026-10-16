/**
 * Import mapping: common spreadsheet headings and the Shelf destination each
 * one means.
 *
 * Covers the exports of the tools people most often move from (Sortly, Asset
 * Panda, Snipe-IT) and the headings of hand-made spreadsheets. Headings are
 * compared in {@link normalizeHeader} form, so "Serial No.", "serial_no" and
 * "SERIAL NO" are one entry. A heading that only holds another system's
 * internal ids ("Sortly ID", "ID") is deliberately absent, so it is skipped.
 *
 * Every entry must resolve to a destination the importer accepts;
 * `synonyms.test.ts` checks that, and that no heading is listed twice.
 *
 * Pure and client-safe.
 *
 * @see {@link file://./heuristics.ts} the matcher that reads this table
 */
import { CustomFieldType } from "@prisma/client";
import type { AssetCsvHeader } from "./fields";

/**
 * Lowercases a header and folds every run of punctuation or whitespace into
 * one space, so "Serial No.", "serial_no" and "SERIAL-NO" compare equal.
 *
 * @param text - Header text
 * @returns The comparable form
 */
export function normalizeHeader(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Where a synonym points, before the workspace's own fields are considered. */
export type SynonymTarget =
  | { kind: "field"; name: AssetCsvHeader }
  | { kind: "customField"; name: string; type: CustomFieldType };

/** One destination and every heading that means it. */
export type SynonymGroup = { target: SynonymTarget; headings: string[] };

const field = (name: AssetCsvHeader): SynonymTarget => ({
  kind: "field",
  name,
});

const customField = (name: string, type: CustomFieldType): SynonymTarget => ({
  kind: "customField",
  name,
  type,
});

/** The table. Order does not matter; each heading appears once. */
export const SYNONYM_GROUPS: SynonymGroup[] = [
  {
    target: field("title"),
    headings: [
      "name",
      "item",
      "item name",
      "asset",
      "asset name",
      "entry name",
      "product",
      "product name",
      "equipment",
      "equipment name",
      "device",
      "device name",
      "item title",
    ],
  },
  {
    target: field("description"),
    headings: [
      "notes",
      "note",
      "comments",
      "comment",
      "details",
      "remarks",
      "item description",
      "asset description",
      "variant details",
    ],
  },
  {
    target: field("category"),
    headings: [
      "categories",
      "group",
      "asset type",
      "item type",
      "equipment type",
      "class",
      "classification",
      "asset category",
      "item category",
    ],
  },
  {
    target: field("tags"),
    headings: ["tag", "labels", "label", "keywords"],
  },
  {
    target: field("location"),
    headings: [
      "room",
      "site",
      "building",
      "where",
      "place",
      "area",
      "office",
      "warehouse",
      "storage",
      "storage location",
      "current location",
      "asset location",
      "folder",
      "primary folder",
    ],
  },
  {
    target: field("custodian"),
    headings: [
      "owner",
      "assigned to",
      "assignee",
      "holder",
      "who has it",
      "checked out to",
      "employee",
      "assigned user",
      "in custody of",
    ],
  },
  {
    target: field("valuation"),
    headings: [
      "value",
      "price",
      "cost",
      "purchase price",
      "purchase cost",
      "unit price",
      "unit cost",
      "worth",
      "current value",
    ],
  },
  {
    target: field("quantity"),
    headings: [
      "qty",
      "count",
      "stock",
      "on hand",
      "quantity on hand",
      "qty on hand",
      "units",
      "amount in stock",
    ],
  },
  {
    target: field("minQuantity"),
    headings: [
      "minimum",
      "min level",
      "min qty",
      "minimum quantity",
      "reorder point",
      "reorder level",
      "low stock",
      "low stock alert",
    ],
  },
  {
    target: field("unitOfMeasure"),
    headings: ["unit", "uom", "units of measure"],
  },
  {
    target: field("imageUrl"),
    headings: [
      "image",
      "photo",
      "photo url",
      "photo1",
      "picture",
      "picture url",
    ],
  },
  {
    target: field("assetModel"),
    headings: ["model", "model name", "product model"],
  },
  {
    target: field("qrId"),
    headings: ["shelf qr", "shelf qr id"],
  },
  {
    target: field("barcode_Code128"),
    headings: ["barcode", "bar code", "barcode number", "code128", "code 128"],
  },
  {
    target: field("barcode_ExternalQR"),
    headings: ["qr", "qr code", "barcode qr1 data", "qr code data"],
  },
  {
    target: field("barcode_EAN13"),
    headings: ["ean", "ean13", "upc", "gtin"],
  },
  { target: field("barcode_Code39"), headings: ["code39", "code 39"] },
  {
    target: field("barcode_DataMatrix"),
    headings: ["datamatrix", "data matrix"],
  },
  {
    target: customField("Serial number", CustomFieldType.TEXT),
    headings: [
      "serial",
      "serial number",
      "serial no",
      "serial nr",
      "serial num",
      "s n",
      "sn",
    ],
  },
  {
    target: customField("Purchase date", CustomFieldType.DATE),
    headings: [
      "purchase date",
      "purchased",
      "date purchased",
      "purchased on",
      "bought",
      "date bought",
      "acquired",
      "acquisition date",
    ],
  },
  {
    target: customField("Warranty expiry", CustomFieldType.DATE),
    headings: [
      "warranty",
      "warranty expiry",
      "warranty expires",
      "warranty until",
      "warranty end",
      "warranty expiration",
    ],
  },
  {
    target: customField("Manufacturer", CustomFieldType.TEXT),
    headings: ["manufacturer", "brand", "make", "vendor brand"],
  },
  {
    target: customField("Model number", CustomFieldType.TEXT),
    headings: ["model no", "model number", "model nr", "part number"],
  },
  {
    target: customField("Asset tag", CustomFieldType.TEXT),
    headings: ["asset tag", "asset tag number", "tag number", "asset id"],
  },
  { target: customField("SKU", CustomFieldType.TEXT), headings: ["sku"] },
  {
    target: customField("Supplier", CustomFieldType.TEXT),
    headings: ["supplier", "vendor", "purchased from"],
  },
  {
    target: customField("Order number", CustomFieldType.TEXT),
    headings: ["order number", "order no", "po number", "purchase order"],
  },
  {
    target: customField("Previous status", CustomFieldType.OPTION),
    headings: ["status", "asset status", "condition"],
  },
  {
    target: customField("Department", CustomFieldType.TEXT),
    headings: ["department", "team"],
  },
];

const BY_HEADING = new Map<string, SynonymTarget>(
  SYNONYM_GROUPS.flatMap(({ target, headings }) =>
    headings.map((heading) => [normalizeHeader(heading), target] as const)
  )
);

/**
 * Looks up the destination a heading usually means.
 *
 * @param header - Header text as it appears in the file
 * @returns The destination, or `undefined` when the heading is not listed
 */
export function lookupSynonym(header: string): SynonymTarget | undefined {
  return BY_HEADING.get(normalizeHeader(header));
}
