/**
 * Printed Document Form
 *
 * The schema of the document edit form on Settings > General, shared by the form
 * (client-side validation) and the settings action (server-side validation).
 *
 * Switches post "on" or "off": each has a hidden "off" input before it, so a
 * switch that is off still sends its value.
 *
 * @see {@link file://../../components/workspace/pdf-documents-settings.tsx}
 * @see {@link file://../../routes/_layout+/settings.general.tsx}
 */
import { z } from "zod";
import {
  DOCUMENT_GROUP_BY,
  DOCUMENT_SORT_BY,
  MAX_DOCUMENT_CUSTOM_FIELDS,
  MAX_DOCUMENT_NAME_LENGTH,
  type BookingDocumentConfig,
} from "./config";

/** The value of a custom field slot with no field picked. */
export const EMPTY_SLOT = "none";

const onOff = z
  .union([z.literal("on"), z.literal("off")])
  .transform((value) => value === "on");

/** A document's name, as typed in the Add and edit forms. */
export const documentNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(
    MAX_DOCUMENT_NAME_LENGTH,
    `Name can be at most ${MAX_DOCUMENT_NAME_LENGTH} characters`
  );

/** The Add document form: just a name; the new document starts as a Checklist. */
export const AddDocumentFormSchema = z.object({ name: documentNameSchema });

/** The document edit form: a name and every switch of the document's config. */
export const PdfDocumentFormSchema = z.object({
  documentId: z.string().min(1),
  name: documentNameSchema,
  columns: z.object({
    image: onOff,
    quantity: onOff,
    kit: onOff,
    category: onOff,
    location: onOff,
  }),
  /** One entry per custom field slot; an empty slot posts "" or "none". */
  customFieldIds: z
    .array(z.string())
    .optional()
    .transform((ids) => [
      ...new Set((ids ?? []).filter((id) => id && id !== EMPTY_SLOT)),
    ])
    .pipe(
      z
        .array(z.string())
        .max(
          MAX_DOCUMENT_CUSTOM_FIELDS,
          `A document prints at most ${MAX_DOCUMENT_CUSTOM_FIELDS} custom fields`
        )
    ),
  assetDescription: onOff,
  groupBy: z.enum(DOCUMENT_GROUP_BY),
  sortBy: z.enum(DOCUMENT_SORT_BY),
  bookingDescription: onOff,
  totalValue: onOff,
  signatureLines: onOff,
});

/**
 * Splits a parsed form into the document's name and its config.
 *
 * @param form - The output of {@link PdfDocumentFormSchema}
 * @returns The name and a complete config
 */
export function documentFromForm(form: z.infer<typeof PdfDocumentFormSchema>): {
  name: string;
  config: BookingDocumentConfig;
} {
  const { documentId: _documentId, name, ...config } = form;
  return { name, config };
}
