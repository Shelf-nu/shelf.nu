import { AssetFilterPresetView } from "@prisma/client";

import { db } from "~/database/db.server";
import { cleanParamsForCookie } from "~/hooks/search-params";
import { ShelfError } from "~/utils/error";

import { MAX_SAVED_FILTER_PRESETS, type SavedFilterView } from "./constants";

const VIEW_MAP: Record<string, AssetFilterPresetView> = {
  availability: AssetFilterPresetView.AVAILABILITY,
  table: AssetFilterPresetView.TABLE,
};

function resolveView(view: string | null | undefined): AssetFilterPresetView {
  return VIEW_MAP[view ?? "table"] ?? AssetFilterPresetView.TABLE;
}

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
export async function listPresetsForUser({
  organizationId,
  ownerId,
}: {
  organizationId: string;
  ownerId: string;
}) {
  return db.assetFilterPreset.findMany({
    where: { organizationId, ownerId },
    orderBy: { name: "asc" },
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
  view,
}: {
  organizationId: string;
  ownerId: string;
  name: string;
  query: string;
  view?: SavedFilterView | string | null;
}) {
  const trimmedName = normalizeName(name);

  // Check preset limit
  const existingCount = await db.assetFilterPreset.count({
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

  // Check for duplicate name
  const existingByName = await db.assetFilterPreset.findFirst({
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

  // Sanitize query to remove pagination params
  const sanitizedQuery = cleanParamsForCookie(query);

  return db.assetFilterPreset.create({
    data: {
      organizationId,
      ownerId,
      name: trimmedName,
      query: sanitizedQuery,
      view: resolveView(view),
    },
  });
}

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
  const preset = await assertPresetOwnership({ id, organizationId, ownerId });
  const trimmedName = normalizeName(name);

  // No change needed
  if (trimmedName === preset.name) {
    return preset;
  }

  // Check for duplicate name
  const duplicate = await db.assetFilterPreset.findFirst({
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

  return db.assetFilterPreset.update({
    where: { id },
    data: { name: trimmedName },
  });
}

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
