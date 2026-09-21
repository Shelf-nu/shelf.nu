/**
 * Saved asset filter presets.
 *
 * A preset is a named URL query for the advanced asset index. It belongs to the
 * user who saved it; setting `shared` publishes it to the whole workspace,
 * where everyone who can open the advanced index may apply it read-only.
 *
 * Ownership decides what may be done to a preset, with one widening: a user who
 * holds `assetIndexSettings:update` may unshare or delete ANY shared preset in
 * the workspace, so a preset does not become unmanageable when its owner leaves.
 * Star and rename stay with the owner.
 *
 * @see {@link file://./../../routes/_layout+/assets._index.tsx} — the intents
 * @see {@link file://./../../components/assets/assets-index/saved-filter-presets.tsx}
 */
import { db } from "~/database/db.server";
import { cleanParamsForCookie } from "~/hooks/search-params";
import { ShelfError } from "~/utils/error";
import { resolveUserDisplayName } from "~/utils/user";

import { MAX_SAVED_FILTER_PRESETS } from "./constants";
import { USER_NAME_SELECT } from "../user/fields";

/**
 * One row of the saved-filters list, as the asset index renders it.
 *
 * Both list functions return this shape so the client never has to guess
 * whether a row is the caller's own: a row missing `isOwn` would render the
 * owner's controls on someone else's preset, which the server then refuses.
 */
export type SavedFilterPresetRow = {
  id: string;
  name: string;
  query: string;
  starred: boolean;
  shared: boolean;
  /** True when the caller owns this preset — the only rows they may edit. */
  isOwn: boolean;
  /** Owner's name for the "Shared by …" line. Null on the caller's own rows. */
  sharedByName: string | null;
};

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

function presetNotFound() {
  return new ShelfError({
    cause: null,
    label: "Assets",
    message: "We couldn't find that saved filter.",
    status: 404,
  });
}

/**
 * Find a preset the caller is allowed to act on, org-scoped.
 *
 * `includeShared` widens the match from "mine" to "mine, or any preset this
 * workspace has shared" — pass it only after proving the caller holds
 * `assetIndexSettings:update`.
 *
 * @throws {ShelfError} 404 when no such preset exists for this caller.
 */
async function findPresetForCaller({
  id,
  organizationId,
  ownerId,
  includeShared = false,
}: {
  id: string;
  organizationId: string;
  ownerId: string;
  includeShared?: boolean;
}) {
  const preset = await db.assetFilterPreset.findFirst({
    where: {
      id,
      organizationId,
      ...(includeShared
        ? { OR: [{ ownerId }, { shared: true }] }
        : { ownerId }),
    },
  });

  if (!preset) {
    throw presetNotFound();
  }

  return preset;
}

/**
 * List the presets a user saved for themselves in an organization.
 *
 * Deliberately excludes the workspace's shared presets: the simple asset index
 * renders no saved-filter control, so shipping other people's preset names and
 * queries in its payload would expose them to a user who cannot act on them.
 * The advanced index uses {@link listPresetsWithShared}.
 */
export async function listPresetsForUser({
  organizationId,
  ownerId,
}: {
  organizationId: string;
  ownerId: string;
}): Promise<SavedFilterPresetRow[]> {
  const presets = await db.assetFilterPreset.findMany({
    where: { organizationId, ownerId },
    orderBy: [{ starred: "desc" }, { name: "asc" }],
  });

  return presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    query: preset.query,
    starred: preset.starred,
    shared: preset.shared,
    isOwn: true,
    sharedByName: null,
  }));
}

/**
 * List what the advanced asset index shows a user: their own presets plus every
 * preset the workspace has shared, each row marked with who owns it.
 *
 * Ordering is the render order: the caller's starred presets, then their
 * remaining presets, then other people's shared ones — each block by name. A
 * shared preset the caller owns stays in their own block, so it appears once,
 * with its star and its controls.
 */
export async function listPresetsWithShared({
  organizationId,
  ownerId,
}: {
  organizationId: string;
  ownerId: string;
}): Promise<SavedFilterPresetRow[]> {
  const presets = await db.assetFilterPreset.findMany({
    where: { organizationId, OR: [{ ownerId }, { shared: true }] },
    orderBy: { name: "asc" },
    include: { owner: { select: USER_NAME_SELECT } },
  });

  const rows = presets.map<SavedFilterPresetRow>((preset) => {
    const isOwn = preset.ownerId === ownerId;

    return {
      id: preset.id,
      name: preset.name,
      query: preset.query,
      starred: preset.starred,
      shared: preset.shared,
      isOwn,
      sharedByName: isOwn ? null : resolveUserDisplayName(preset.owner),
    };
  });

  return [
    ...rows.filter((row) => row.isOwn && row.starred),
    ...rows.filter((row) => row.isOwn && !row.starred),
    ...rows.filter((row) => !row.isOwn),
  ];
}

/**
 * Create a new filter preset.
 *
 * The cap and the duplicate-name check both count the caller's own presets
 * only: a preset someone else shared with the workspace costs the caller
 * nothing, and may carry a name they also use for one of their own.
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
        shouldBeCaptured: false,
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
 * Rename an existing filter preset. Owner-only, sharing does not widen it.
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
      throw presetNotFound();
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
        shouldBeCaptured: false,
      });
    }

    // Update the preset within transaction.
    // ownership (id + organizationId + ownerId) is proven above
    // within this same tx before this update.
    return tx.assetFilterPreset.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: ownership (id + organizationId + ownerId) proven in this same tx above
      where: { id },
      data: { name: trimmedName },
    });
  });
}
/** End of renamePreset function */

/**
 * Publish a preset to the workspace, or take it back.
 *
 * Sharing requires ownership — a user publishes their own view, never someone
 * else's. Unsharing also accepts an already-shared preset owned by anyone, so a
 * privileged user can retire a view whose owner has left. The route proves
 * `assetIndexSettings:update` before either.
 *
 * @throws {ShelfError} 404 when the caller may not act on that preset.
 */
export async function setPresetShared({
  id,
  organizationId,
  ownerId,
  shared,
}: {
  id: string;
  organizationId: string;
  /** The acting user, who must own the preset to share it. */
  ownerId: string;
  shared: boolean;
}) {
  await findPresetForCaller({
    id,
    organizationId,
    ownerId,
    includeShared: !shared,
  });

  return db.assetFilterPreset.update({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: the findFirst above proves id + organizationId plus ownership (or a shared preset the caller's assetIndexSettings:update covers)
    where: { id },
    data: { shared },
  });
}
/** End of setPresetShared function */

/**
 * Delete a filter preset.
 *
 * The owner may delete their own. `canManageSharedPresets` — the caller's
 * `assetIndexSettings:update` — additionally covers presets SHARED by other
 * people, so an abandoned workspace view can be cleaned up. It never reaches
 * another person's private preset, which the caller cannot even see.
 */
export async function deletePreset({
  id,
  organizationId,
  ownerId,
  canManageSharedPresets = false,
}: {
  id: string;
  organizationId: string;
  ownerId: string;
  canManageSharedPresets?: boolean;
}) {
  await findPresetForCaller({
    id,
    organizationId,
    ownerId,
    includeShared: canManageSharedPresets,
  });

  return db.assetFilterPreset.delete({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: the lookup above proves id + organizationId plus ownership (or a shared preset the caller's assetIndexSettings:update covers)
    where: { id },
  });
}
/** End of deletePreset function */

/**
 * Toggle the starred state of a filter preset. Owner-only: a star is one
 * person's shortcut, so it stays on the owner's row even once shared.
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
  await findPresetForCaller({ id, organizationId, ownerId });

  return db.assetFilterPreset.update({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: findPresetForCaller above proves id + organizationId + ownerId before this update
    where: { id },
    data: { starred },
  });
}
/** End of togglePresetStar function */
