import { db } from "~/database/db.server";
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
  const preset = await db.assetFilterPreset.findFirst({
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
  return db.assetFilterPreset.findMany({
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

  // Use a transaction to avoid race conditions between count check and insert
  return db.$transaction(async (tx) => {
    // Check preset limit within transaction
    const existingCount = await tx.assetFilterPreset.count({
      where: { organizationId, ownerId },
    });

    if (existingCount >= MAX_SAVED_FILTER_PRESETS) {
      throw new ShelfError({
        cause: null,
        label: "Assets",
        message: `You can only save up to ${MAX_SAVED_FILTER_PRESETS} filter presets. Please delete one before creating a new one.`,
        status: 400,
      });
    }

    // Check for duplicate name within transaction
    const existingByName = await tx.assetFilterPreset.findFirst({
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

    // Create the preset within transaction
    return tx.assetFilterPreset.create({
      data: {
        organizationId,
        ownerId,
        name: trimmedName,
        query: sanitizedQuery,
      },
    });
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

  // Use a transaction to avoid race conditions during rename
  return db.$transaction(async (tx) => {
    // Assert ownership and get current preset within transaction
    const preset = await tx.assetFilterPreset.findFirst({
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

    // Check for duplicate name within transaction
    const duplicate = await tx.assetFilterPreset.findFirst({
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

    // Update the preset within transaction
    return tx.assetFilterPreset.update({
      where: { id },
      data: { name: trimmedName },
    });
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

  return db.assetFilterPreset.delete({ where: { id } });
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

  return db.assetFilterPreset.update({
    where: { id },
    data: { starred },
  });
}
/** End of togglePresetStar function */
