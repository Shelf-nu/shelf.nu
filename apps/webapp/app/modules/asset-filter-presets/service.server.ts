import { sbDb } from "~/database/supabase.server";
import { cleanParamsForCookie } from "~/hooks/search-params";
import { ShelfError } from "~/utils/error";

import { MAX_SAVED_FILTER_PRESETS } from "./constants";

function normalizeName(name: string): string {
  const trimmed = name.trim();

  if (!trimmed) {
    throw new ShelfError({
      cause: null,
      label: "Assets",
      message: "Name is required.",
      status: 400,
    });
  }

  return trimmed;
}

async function assertPresetOwnership({
  id,
  organizationId,
  ownerId,
}: {
  id: string;
  organizationId: string;
  ownerId: string;
}) {
  const { data: preset, error } = await sbDb
    .from("AssetFilterPreset")
    .select("*")
    .eq("id", id)
    .eq("organizationId", organizationId)
    .eq("ownerId", ownerId)
    .maybeSingle();

  if (error) throw error;

  if (!preset) {
    throw new ShelfError({
      cause: null,
      label: "Assets",
      message: "We couldn't find that saved filter.",
      status: 404,
    });
  }

  return preset;
}

/**
 * List all filter presets for a user within an organization
 */
export async function listPresetsForUser({
  organizationId,
  ownerId,
}: {
  organizationId: string;
  ownerId: string;
}) {
  const { data, error } = await sbDb
    .from("AssetFilterPreset")
    .select("*")
    .eq("organizationId", organizationId)
    .eq("ownerId", ownerId)
    .order("starred", { ascending: false })
    .order("name", { ascending: true });

  if (error) throw error;

  return data;
}

/**
 * Create a new filter preset
 */
export async function createPreset({
  organizationId,
  ownerId,
  name,
  query,
}: {
  organizationId: string;
  ownerId: string;
  name: string;
  query: string;
}) {
  const trimmedName = normalizeName(name);

  // Sanitize query to remove pagination params
  const sanitizedQuery = cleanParamsForCookie(query);

  // Check preset limit
  const { count: existingCount, error: countError } = await sbDb
    .from("AssetFilterPreset")
    .select("*", { count: "exact", head: true })
    .eq("organizationId", organizationId)
    .eq("ownerId", ownerId);

  if (countError) throw countError;

  if ((existingCount ?? 0) >= MAX_SAVED_FILTER_PRESETS) {
    throw new ShelfError({
      cause: null,
      label: "Assets",
      message: `You can only save up to ${MAX_SAVED_FILTER_PRESETS} filter presets. Please delete one before creating a new one.`,
      status: 400,
    });
  }

  // Check for duplicate name
  const { data: existingByName, error: nameError } = await sbDb
    .from("AssetFilterPreset")
    .select("id")
    .eq("organizationId", organizationId)
    .eq("ownerId", ownerId)
    .eq("name", trimmedName)
    .maybeSingle();

  if (nameError) throw nameError;

  if (existingByName) {
    throw new ShelfError({
      cause: null,
      label: "Assets",
      message:
        "You already have a preset with this name. Please use a different name.",
      status: 409,
    });
  }

  // Create the preset
  const { data: preset, error: createError } = await sbDb
    .from("AssetFilterPreset")
    .insert({
      organizationId,
      ownerId,
      name: trimmedName,
      query: sanitizedQuery,
    })
    .select()
    .single();

  if (createError) throw createError;

  return preset;
}
/** End of createPreset function */

/**
 * Rename an existing filter preset
 */
export async function renamePreset({
  id,
  organizationId,
  ownerId,
  name,
}: {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
}) {
  const trimmedName = normalizeName(name);

  // Assert ownership and get current preset
  const { data: preset, error: findError } = await sbDb
    .from("AssetFilterPreset")
    .select("*")
    .eq("id", id)
    .eq("organizationId", organizationId)
    .eq("ownerId", ownerId)
    .maybeSingle();

  if (findError) throw findError;

  if (!preset) {
    throw new ShelfError({
      cause: null,
      label: "Assets",
      message: "We couldn't find that saved filter.",
      status: 404,
    });
  }

  // No change needed
  if (trimmedName === preset.name) {
    return preset;
  }

  // Check for duplicate name
  const { data: duplicate, error: dupError } = await sbDb
    .from("AssetFilterPreset")
    .select("id")
    .eq("organizationId", organizationId)
    .eq("ownerId", ownerId)
    .eq("name", trimmedName)
    .neq("id", id)
    .maybeSingle();

  if (dupError) throw dupError;

  if (duplicate) {
    throw new ShelfError({
      cause: null,
      label: "Assets",
      message:
        "You already have a preset with this name. Please use a different name.",
      status: 409,
    });
  }

  // Update the preset
  const { data: updated, error: updateError } = await sbDb
    .from("AssetFilterPreset")
    .update({ name: trimmedName })
    .eq("id", id)
    .select()
    .single();

  if (updateError) throw updateError;

  return updated;
}
/** End of renamePreset function */

/**
 * Delete a filter preset
 */
export async function deletePreset({
  id,
  organizationId,
  ownerId,
}: {
  id: string;
  organizationId: string;
  ownerId: string;
}) {
  await assertPresetOwnership({ id, organizationId, ownerId });

  const { error } = await sbDb.from("AssetFilterPreset").delete().eq("id", id);

  if (error) throw error;
}
/** End of deletePreset function */

/**
 * Toggle the starred state of a filter preset
 */
export async function togglePresetStar({
  id,
  starred,
  organizationId,
  ownerId,
}: {
  id: string;
  starred: boolean;
  organizationId: string;
  ownerId: string;
}) {
  await assertPresetOwnership({ id, organizationId, ownerId });

  const { data, error } = await sbDb
    .from("AssetFilterPreset")
    .update({ starred })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data;
}
/** End of togglePresetStar function */
