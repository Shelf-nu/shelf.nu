import { db } from "~/database/db.server";
import {
  count,
  create,
  findFirst,
  remove,
  update,
  findMany,
} from "~/database/query-helpers.server";
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
  const preset = await findFirst(db, "AssetFilterPreset", {
    where: { id, organizationId, ownerId },
  });

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
export function listPresetsForUser({
  organizationId,
  ownerId,
}: {
  organizationId: string;
  ownerId: string;
}) {
  return findMany(db, "AssetFilterPreset", {
    where: { organizationId, ownerId },
    orderBy: [{ starred: "desc" }, { name: "asc" }],
  });
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

  // Check preset limit (sequential instead of transaction)
  const existingCount = await count(db, "AssetFilterPreset", {
    organizationId,
    ownerId,
  });

  if (existingCount >= MAX_SAVED_FILTER_PRESETS) {
    throw new ShelfError({
      cause: null,
      label: "Assets",
      message: `You can only save up to ${MAX_SAVED_FILTER_PRESETS} filter presets. Please delete one before creating a new one.`,
      status: 400,
    });
  }

  // Check for duplicate name
  const existingByName = await findFirst(db, "AssetFilterPreset", {
    where: { organizationId, ownerId, name: trimmedName },
  });

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
  return create(db, "AssetFilterPreset", {
    organizationId,
    ownerId,
    name: trimmedName,
    query: sanitizedQuery,
  });
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

  // Assert ownership and get current preset (sequential instead of transaction)
  const preset = await findFirst(db, "AssetFilterPreset", {
    where: { id, organizationId, ownerId },
  });

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
  const duplicate = await findFirst(db, "AssetFilterPreset", {
    where: {
      organizationId,
      ownerId,
      name: trimmedName,
      NOT: { id },
    },
  });

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
  return update(db, "AssetFilterPreset", {
    where: { id },
    data: { name: trimmedName },
  });
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

  return remove(db, "AssetFilterPreset", { id });
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

  return update(db, "AssetFilterPreset", {
    where: { id },
    data: { starred },
  });
}
/** End of togglePresetStar function */
