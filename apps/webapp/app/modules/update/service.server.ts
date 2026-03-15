import type { RenderableTreeNode } from "@markdoc/markdoc";
import type {
  OrganizationRoles,
  Update,
  UpdateStatus,
  User,
  UserUpdateRead,
} from "@shelf/database";
import { UpdateStatus as UpdateStatusEnum } from "@shelf/database";
import { db } from "~/database/db.server";
import {
  count,
  create,
  createMany,
  findFirst,
  findMany,
  findUnique,
  remove,
  update,
  upsert,
} from "~/database/query-helpers.server";
import { throwIfError } from "~/database/query-helpers.server";
import { ShelfError } from "~/utils/error";

export type UpdateWithRelations = Update & {
  createdBy: Pick<User, "id" | "firstName" | "lastName"> | null;
  userReads: UserUpdateRead[];
  userReadsCount?: number;
};

export type UpdateForUser = Update & {
  content: RenderableTreeNode;
  userReads: UserUpdateRead[];
};

/**
 * Get all updates visible to a specific user based on their role
 */
export async function getUpdatesForUser({
  userId,
  userRole,
}: {
  userId: string;
  userRole: OrganizationRoles;
}): Promise<UpdateForUser[]> {
  // Supabase can't filter on array contains/isEmpty natively in PostgREST,
  // so we fetch published updates and filter in app code
  const updates = await findMany(db, "Update", {
    where: {
      status: UpdateStatusEnum.PUBLISHED,
      publishDate: { lte: new Date().toISOString() },
    },
    orderBy: { publishDate: "desc" },
  });

  // Filter by target roles (empty means all roles)
  const filteredUpdates = updates.filter(
    (u) =>
      !u.targetRoles ||
      (u.targetRoles as string[]).length === 0 ||
      (u.targetRoles as string[]).includes(userRole)
  );

  // Get user reads for these updates
  const updateIds = filteredUpdates.map((u) => u.id);
  const userReads =
    updateIds.length > 0
      ? await findMany(db, "UserUpdateRead", {
          where: {
            userId,
            updateId: { in: updateIds },
          },
        })
      : [];

  return filteredUpdates.map((u) => ({
    ...u,
    userReads: userReads.filter((r) => r.updateId === u.id),
  })) as UpdateForUser[];
}

/**
 * Get unread count for a user
 */
export async function getUnreadCountForUser({
  userId,
  userRole,
}: {
  userId: string;
  userRole: OrganizationRoles;
}): Promise<number> {
  // Get all published updates visible to user
  const updates = await getUpdatesForUser({ userId, userRole });
  // Count those with no read records
  return updates.filter((u) => u.userReads.length === 0).length;
}

/**
 * Mark an update as read by a user and increment view count
 */
export async function markUpdateAsRead({
  updateId,
  userId,
}: {
  updateId: string;
  userId: string;
}): Promise<void> {
  await upsert(
    db,
    "UserUpdateRead",
    {
      userId,
      updateId,
      readAt: new Date().toISOString(),
    },
    { onConflict: "userId,updateId" }
  );

  // Increment view count via raw RPC since Supabase doesn't support increment
  const current = await findUnique(db, "Update", {
    where: { id: updateId },
  });
  if (current) {
    await update(db, "Update", {
      where: { id: updateId },
      data: { viewCount: (current.viewCount || 0) + 1 },
    });
  }
}

/**
 * Mark all updates as read for a user
 */
export async function markAllUpdatesAsRead({
  userId,
  userRole,
}: {
  userId: string;
  userRole: OrganizationRoles;
}): Promise<void> {
  // Get unread updates
  const allUpdates = await getUpdatesForUser({ userId, userRole });
  const unreadUpdates = allUpdates.filter((u) => u.userReads.length === 0);

  if (unreadUpdates.length === 0) return;

  // Create read records
  await createMany(
    db,
    "UserUpdateRead",
    unreadUpdates.map((u) => ({
      userId,
      updateId: u.id,
    }))
  );

  // Increment view counts for each update
  for (const u of unreadUpdates) {
    await update(db, "Update", {
      where: { id: u.id },
      data: { viewCount: (u.viewCount || 0) + 1 },
    });
  }
}

/**
 * Track view of an update (increment view count only)
 */
export async function trackUpdateView({
  updateId,
}: {
  updateId: string;
}): Promise<void> {
  const current = await findUnique(db, "Update", {
    where: { id: updateId },
  });
  if (current) {
    await update(db, "Update", {
      where: { id: updateId },
      data: { viewCount: (current.viewCount || 0) + 1 },
    });
  }
}

/**
 * Track click on an update (increment click count)
 */
export async function trackUpdateClick({
  updateId,
}: {
  updateId: string;
}): Promise<void> {
  const current = await findUnique(db, "Update", {
    where: { id: updateId },
  });
  if (current) {
    await update(db, "Update", {
      where: { id: updateId },
      data: { clickCount: (current.clickCount || 0) + 1 },
    });
  }
}

// ===== ADMIN FUNCTIONS =====

/**
 * Get a single update by ID for admin editing
 */
export async function getUpdateById(
  id: string
): Promise<UpdateWithRelations | null> {
  const upd = await findUnique(db, "Update", { where: { id } });
  if (!upd) return null;

  const [createdBy, userReads] = await Promise.all([
    upd.createdById
      ? findFirst(db, "User", {
          where: { id: upd.createdById },
          select: "id, firstName, lastName",
        })
      : null,
    findMany(db, "UserUpdateRead", {
      where: { updateId: id },
    }),
  ]);

  return {
    ...upd,
    createdBy: createdBy as Pick<User, "id" | "firstName" | "lastName"> | null,
    userReads,
    userReadsCount: userReads.length,
  };
}

/**
 * Get all updates for admin dashboard with analytics
 */
export async function getAllUpdatesForAdmin(): Promise<UpdateWithRelations[]> {
  const updates = await findMany(db, "Update", {
    orderBy: { publishDate: "desc" },
  });

  const results: UpdateWithRelations[] = [];
  for (const upd of updates) {
    const [createdBy, userReads] = await Promise.all([
      upd.createdById
        ? findFirst(db, "User", {
            where: { id: upd.createdById },
            select: "id, firstName, lastName",
          })
        : null,
      findMany(db, "UserUpdateRead", {
        where: { updateId: upd.id },
      }),
    ]);

    results.push({
      ...upd,
      createdBy: createdBy as Pick<
        User,
        "id" | "firstName" | "lastName"
      > | null,
      userReads,
      userReadsCount: userReads.length,
    });
  }

  return results;
}

/**
 * Create a new update
 */
export async function createUpdate({
  title,
  content,
  url,
  imageUrl,
  publishDate,
  status = UpdateStatusEnum.DRAFT,
  targetRoles = [],
  createdById,
}: {
  title: string;
  content: string;
  url?: string | null;
  imageUrl?: string | null;
  publishDate: Date;
  status?: UpdateStatus;
  targetRoles?: OrganizationRoles[];
  createdById: string;
}): Promise<void> {
  try {
    await create(db, "Update", {
      title,
      content,
      url: url === undefined ? null : url,
      imageUrl: imageUrl === undefined ? null : imageUrl,
      publishDate: publishDate.toISOString(),
      status,
      targetRoles: targetRoles as string[],
      createdById,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create update",
      additionalData: { title, url, createdById },
      label: "Update",
    });
  }
}

/**
 * Update an existing update
 */
export async function updateUpdate({
  id,
  title,
  content,
  url,
  imageUrl,
  publishDate,
  status,
  targetRoles,
}: {
  id: string;
  title?: string;
  content?: string;
  url?: string | null;
  imageUrl?: string | null;
  publishDate?: Date;
  status?: UpdateStatus;
  targetRoles?: OrganizationRoles[];
}): Promise<void> {
  try {
    const data: Record<string, unknown> = {};
    if (title !== undefined) data.title = title;
    if (content !== undefined) data.content = content;
    if (url !== undefined) data.url = url;
    if (imageUrl !== undefined) data.imageUrl = imageUrl;
    if (publishDate !== undefined) data.publishDate = publishDate.toISOString();
    if (status !== undefined) data.status = status;
    if (targetRoles !== undefined) data.targetRoles = targetRoles;

    await update(db, "Update", {
      where: { id },
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update update",
      additionalData: { id },
      label: "Update",
    });
  }
}

/**
 * Delete an update
 */
export async function deleteUpdate({ id }: { id: string }): Promise<void> {
  try {
    await remove(db, "Update", { id });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to delete update",
      additionalData: { id },
      label: "Update",
    });
  }
}
