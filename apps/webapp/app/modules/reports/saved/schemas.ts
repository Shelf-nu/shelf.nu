/**
 * Form schemas for the saved-report actions on `/reports/builder`.
 *
 * Each schema carries its `intent` literal so the same object validates on the
 * client (`useZorm`) and on the server (`parseData`).
 *
 * @see {@link file://../../../routes/_layout+/reports.builder.tsx}
 */

import { z } from "zod";
import { SAVED_REPORT_NAME_MAX_LENGTH } from "./constants";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(SAVED_REPORT_NAME_MAX_LENGTH, "Name too long");

/** Saves the report currently shown in the builder under a name. */
export const SaveReportFormSchema = z.object({
  intent: z.literal("save-report"),
  name: nameSchema,
  /** The builder page's query string; the server strips unknown keys. */
  query: z.string(),
});

/** Renames a saved report. */
export const RenameSavedReportFormSchema = z.object({
  intent: z.literal("rename-report"),
  reportId: z.string().min(1, "Report ID is required"),
  name: nameSchema,
});

/** Deletes a saved report. */
export const DeleteSavedReportFormSchema = z.object({
  intent: z.literal("delete-report"),
  reportId: z.string().min(1, "Report ID is required"),
});
