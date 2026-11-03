/**
 * Printed Template Config
 *
 * The switches a booking template holds, the two built-in templates every workspace
 * starts with, and the parser that turns a stored `PdfTemplate.config` into a
 * complete config. Client-safe: the settings form and the PDF renderer read
 * these as well as the server.
 *
 * A stored config is parsed key by key and every key it lacks or holds in an
 * unreadable shape takes the Checklist template's value, so a row saved before a
 * key existed still prints.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://../../components/booking/booking-overview-pdf.tsx}
 */
import type { CustomFieldType } from "@prisma/client";
import { z } from "zod";

/** The most custom fields one template prints. */
export const MAX_TEMPLATE_CUSTOM_FIELDS = 3;

/** The longest template name, in characters. */
export const MAX_TEMPLATE_NAME_LENGTH = 60;

/**
 * Custom field types that print as a column. Each one fits a table cell as a
 * short line of text.
 */
export const TEMPLATE_COLUMN_CUSTOM_FIELD_TYPES = [
  "TEXT",
  "OPTION",
  "DATE",
  "AMOUNT",
  "NUMBER",
  "BOOLEAN",
] as const satisfies readonly CustomFieldType[];

/**
 * Whether a custom field of this type prints as its own column. Every other
 * type is a multi-line text, which prints inside the asset's description row
 * instead, so only while that row is on.
 */
export function printsAsColumn(type: CustomFieldType) {
  return (
    TEMPLATE_COLUMN_CUSTOM_FIELD_TYPES as readonly CustomFieldType[]
  ).includes(type);
}

/** The optional columns of the asset table. `#`, Name and Code always print. */
export const TEMPLATE_OPTIONAL_COLUMNS = [
  { key: "image", label: "Image" },
  { key: "quantity", label: "Qty" },
  { key: "kit", label: "Kit" },
  { key: "category", label: "Category" },
  { key: "location", label: "Location" },
] as const;

export type TemplateOptionalColumn =
  (typeof TEMPLATE_OPTIONAL_COLUMNS)[number]["key"];

/** How the asset rows are grouped: not at all, or under one header per category. */
export const TEMPLATE_GROUP_BY = ["none", "category"] as const;

/**
 * The order of the asset rows. `status` follows the booking page's order,
 * which is status (what still has to be picked first) unless the person
 * sorted the page otherwise; `name` is A to Z by name, with a kit's members
 * kept together at the kit's place, as on the booking page.
 */
export const TEMPLATE_SORT_BY = ["status", "name"] as const;

export type TemplateGroupBy = (typeof TEMPLATE_GROUP_BY)[number];
export type TemplateSortBy = (typeof TEMPLATE_SORT_BY)[number];

export const TEMPLATE_GROUP_BY_OPTIONS = [
  { value: "none", label: "No grouping" },
  { value: "category", label: "Category" },
] as const satisfies readonly { value: TemplateGroupBy; label: string }[];

export const TEMPLATE_SORT_BY_OPTIONS = [
  { value: "status", label: "Same as the booking page (status by default)" },
  { value: "name", label: "Name (A to Z, kits kept together)" },
] as const satisfies readonly { value: TemplateSortBy; label: string }[];

/** Everything a booking template decides about the printed page. */
export type BookingTemplateConfig = {
  /** Optional asset table columns, each printed or not. */
  columns: Record<TemplateOptionalColumn, boolean>;
  /**
   * Custom fields to print, in this order, at most
   * {@link MAX_TEMPLATE_CUSTOM_FIELDS}. Column types print as columns before
   * Code; a multi-line text prints in the description row.
   */
  customFieldIds: string[];
  /** The "Asset Description" row under each asset. */
  assetDescription: boolean;
  groupBy: TemplateGroupBy;
  sortBy: TemplateSortBy;
  /** The booking's description in the header. */
  bookingDescription: boolean;
  /** The "Total assets value" line in the header. */
  totalValue: boolean;
  /** The custodian and issuer signature lines under the table. */
  signatureLines: boolean;
};

/** The "Checklist" template: the booking PDF exactly as it prints without templates. */
export const BOOKING_CHECKLIST_CONFIG: BookingTemplateConfig = {
  columns: {
    image: true,
    quantity: true,
    kit: true,
    category: true,
    location: true,
  },
  customFieldIds: [],
  assetDescription: true,
  groupBy: "none",
  sortBy: "status",
  bookingDescription: true,
  totalValue: true,
  signatureLines: false,
};

/**
 * The "Check-out receipt" template: the signed list of what went out, the
 * departure twin of the check-in receipt. No descriptions and no value, rows A
 * to Z, signature lines at the foot.
 */
export const CHECKOUT_RECEIPT_CONFIG: BookingTemplateConfig = {
  ...BOOKING_CHECKLIST_CONFIG,
  assetDescription: false,
  sortBy: "name",
  bookingDescription: false,
  totalValue: false,
  signatureLines: true,
};

/** The name of the built-in default template. */
export const CHECKLIST_TEMPLATE_NAME = "Checklist";

/** The name of the built-in check-out receipt template. */
export const CHECKOUT_RECEIPT_TEMPLATE_NAME = "Check-out receipt";

/**
 * The templates a workspace that can use bookings starts with, in list order;
 * the first is the default: the Checklist, then the Check-out receipt. The
 * data migration `20261028120000_add_pdf_documents` seeds the same for
 * workspaces that existed before templates.
 */
export function builtInBookingTemplates() {
  return [
    {
      name: CHECKLIST_TEMPLATE_NAME,
      config: BOOKING_CHECKLIST_CONFIG,
      isDefault: true,
    },
    {
      name: CHECKOUT_RECEIPT_TEMPLATE_NAME,
      config: CHECKOUT_RECEIPT_CONFIG,
      isDefault: false,
    },
  ];
}

const fallback = BOOKING_CHECKLIST_CONFIG;

const storedConfigSchema = z
  .object({
    columns: z
      .object({
        image: z.boolean().catch(fallback.columns.image),
        quantity: z.boolean().catch(fallback.columns.quantity),
        kit: z.boolean().catch(fallback.columns.kit),
        category: z.boolean().catch(fallback.columns.category),
        location: z.boolean().catch(fallback.columns.location),
      })
      .catch(fallback.columns),
    customFieldIds: z
      .array(z.string())
      .transform((ids) =>
        [...new Set(ids)].slice(0, MAX_TEMPLATE_CUSTOM_FIELDS)
      )
      .catch(fallback.customFieldIds),
    assetDescription: z.boolean().catch(fallback.assetDescription),
    groupBy: z.enum(TEMPLATE_GROUP_BY).catch(fallback.groupBy),
    sortBy: z.enum(TEMPLATE_SORT_BY).catch(fallback.sortBy),
    bookingDescription: z.boolean().catch(fallback.bookingDescription),
    totalValue: z.boolean().catch(fallback.totalValue),
    signatureLines: z.boolean().catch(fallback.signatureLines),
  })
  .catch(fallback);

/**
 * Reads a stored `PdfTemplate.config` into a complete config.
 *
 * Never throws. A missing or unreadable key takes the Checklist template's value,
 * so an older row, or one written by hand, still prints a sensible page.
 *
 * @param stored - The JSON value from the database
 * @returns A config with every key present
 */
export function parseBookingTemplateConfig(
  stored: unknown
): BookingTemplateConfig {
  const value =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? stored
      : {};
  return storedConfigSchema.parse(value);
}

/** One PDF template as the print dialog and the settings list see it. */
export type PdfTemplateSummary = {
  id: string;
  name: string;
  isDefault: boolean;
};
