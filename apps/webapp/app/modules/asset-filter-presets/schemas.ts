import { z } from "zod";

/**
 * Schema for creating a new filter preset.
 * Used by both client (useZorm) and server (parseData) validation.
 */
export const CreatePresetFormSchema = z.object({
  intent: z.literal("create-preset"),
  name: z.string().min(1, "Name is required").max(60, "Name too long"),
  query: z.string(),
});

/**
 * Schema for renaming an existing preset.
 * Used by both client (useZorm) and server (parseData) validation.
 */
export const RenamePresetFormSchema = z.object({
  intent: z.literal("rename-preset"),
  presetId: z.string().min(1, "Preset ID is required"),
  name: z.string().min(1, "Name is required").max(60, "Name too long"),
});

/**
 * Schema for deleting a preset.
 * Used by server (parseData) validation.
 */
export const DeletePresetFormSchema = z.object({
  intent: z.literal("delete-preset"),
  presetId: z.string().min(1, "Preset ID is required"),
});
