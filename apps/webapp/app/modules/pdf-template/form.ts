/**
 * Printed Template Form
 *
 * The schema of the template edit form on Settings > General, shared by the form
 * (client-side validation) and the settings action (server-side validation).
 *
 * Switches post "on" or "off": each has a hidden "off" input before it, so a
 * switch that is off still sends its value.
 *
 * @see {@link file://../../components/booking/pdf-templates-settings.tsx}
 * @see {@link file://../../routes/_layout+/settings.general.tsx}
 */
import { z } from "zod";
import {
  TEMPLATE_GROUP_BY,
  TEMPLATE_SORT_BY,
  MAX_TEMPLATE_CUSTOM_FIELDS,
  MAX_TEMPLATE_NAME_LENGTH,
  type BookingTemplateConfig,
} from "./config";

/** The value of a custom field slot with no field picked. */
export const EMPTY_SLOT = "none";

const onOff = z
  .union([z.literal("on"), z.literal("off")])
  .transform((value) => value === "on");

/** A template's name, as typed in the Add and edit forms. */
export const templateNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(
    MAX_TEMPLATE_NAME_LENGTH,
    `Name can be at most ${MAX_TEMPLATE_NAME_LENGTH} characters`
  );

/** The Add template form: just a name; the new template starts as a Checklist. */
export const AddTemplateFormSchema = z.object({ name: templateNameSchema });

/** The template edit form: a name and every switch of the template's config. */
export const PdfTemplateFormSchema = z.object({
  templateId: z.string().min(1),
  name: templateNameSchema,
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
          MAX_TEMPLATE_CUSTOM_FIELDS,
          `A template prints at most ${MAX_TEMPLATE_CUSTOM_FIELDS} custom fields`
        )
    ),
  assetDescription: onOff,
  groupBy: z.enum(TEMPLATE_GROUP_BY),
  sortBy: z.enum(TEMPLATE_SORT_BY),
  bookingDescription: onOff,
  totalValue: onOff,
  signatureLines: onOff,
});

/**
 * Splits a parsed form into the template's name and its config.
 *
 * @param form - The output of {@link PdfTemplateFormSchema}
 * @returns The name and a complete config
 */
export function templateFromForm(form: z.infer<typeof PdfTemplateFormSchema>): {
  name: string;
  config: BookingTemplateConfig;
} {
  const { templateId: _templateId, name, ...config } = form;
  return { name, config };
}
