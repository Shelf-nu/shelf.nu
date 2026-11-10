/**
 * Asset Model Form Schema
 *
 * Shared by the settings page form and the inline create form. It lives apart
 * from both so that the inline form, which loads inside dialogs on many pages,
 * does not import the settings form and the custom field editors it renders.
 *
 * @see {@link file://./form.tsx}
 * @see {@link file://./inline-form.tsx}
 */
import z from "zod";
import { optionalNumberFromString } from "~/utils/zod-numeric";

/** Zod schema for creating/editing an asset model. */
export const AssetModelFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  defaultCategoryId: z.string().optional(),
  defaultValuation: optionalNumberFromString({
    blank: null,
    fieldName: "Default valuation",
  }),
  preventRedirect: z.string().optional(),
});
