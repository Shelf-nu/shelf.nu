import type { OrganizationRoles } from "@prisma/client";
import { UpdateStatus } from "@prisma/client";
import type { Sb } from "@shelf/database";
import { sbDb } from "~/database/supabase.server";
import { ShelfError } from "~/utils/error";

/** Shape returned by the get_updates_for_user RPC */
type UpdateForUserRpcRow = {
  id: string;
  title: string;
  content: string;
  url: string | null;
  imageUrl: string | null;
  publishDate: string;
  status: string;
  targetRoles: OrganizationRoles[];
  clickCount: number;
  viewCount: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  userReadId: string | null;
  userReadAt: string | null;
};

export type UpdateForUser = {
  id: string;
  title: string;
  content: string;
  url: string | null;
  imageUrl: string | null;
  publishDate: string;
  status: UpdateStatus;
  targetRoles: OrganizationRoles[];
  clickCount: number;
  viewCount: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  userReads: { id: string; userId: string; updateId: string; readAt: string }[];
};

export type UpdateWithRelations = {
  id: string;
  title: string;
  content: string;
  url: string | null;
  imageUrl: string | null;
  publishDate: string;
  status: UpdateStatus;
  targetRoles: OrganizationRoles[];
  clickCount: number;
  viewCount: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  createdBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  };
  userReads: {
    id: string;
    userId: string;
    updateId: string;
    readAt: string;
  }[];
  _count: {
    userReads: number;
  };
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
  try {
    const { data, error } = await sbDb.rpc("get_updates_for_user", {
      p_user_id: userId,
      p_user_role: userRole,
    });

    if (error) throw error;

    // Group rows by update ID and collect userRead info
    const updatesMap = new Map<string, UpdateForUser>();

    for (const row of (data as UpdateForUserRpcRow[]) ?? []) {
      if (!updatesMap.has(row.id)) {
        updatesMap.set(row.id, {
          id: row.id,
          title: row.title,
          content: row.content,
          url: row.url,
          imageUrl: row.imageUrl,
          publishDate: row.publishDate,
          status: row.status as UpdateStatus,
          targetRoles: row.targetRoles,
          clickCount: row.clickCount,
          viewCount: row.viewCount,
          createdById: row.createdById,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          userReads: [],
        });
      }

      if (row.userReadId) {
        updatesMap.get(row.id)!.userReads.push({
          id: row.userReadId,
          userId,
          updateId: row.id,
          readAt: row.userReadAt!,
        });
      }
    }

    return Array.from(updatesMap.values());
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get updates for user",
      additionalData: { userId, userRole },
      label: "Update",
    });
  }
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
  try {
    const { data, error } = await sbDb.rpc("get_unread_update_count", {
      p_user_id: userId,
      p_user_role: userRole,
    });

    if (error) throw error;

    return (data as number) ?? 0;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get unread update count",
      additionalData: { userId, userRole },
      label: "Update",
    });
  }
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
  try {
    // Upsert the read record
    const { error: upsertError } = await sbDb.from("UserUpdateRead").upsert(
      {
        userId,
        updateId,
        readAt: new Date().toISOString(),
      } as Sb.UserUpdateReadInsert,
      { onConflict: "userId,updateId" }
    );

    if (upsertError) throw upsertError;

    // Increment view count via RPC
    const { error: rpcError } = await sbDb.rpc("increment_update_view_count", {
      update_id: updateId,
    });

    if (rpcError) throw rpcError;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to mark update as read",
      additionalData: { updateId, userId },
      label: "Update",
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
  try {
    // Get all unread update IDs via RPC
    const { data: unreadIds, error: idsError } = await sbDb.rpc(
      "get_unread_update_ids",
      {
        p_user_id: userId,
        p_user_role: userRole,
      }
    );

    if (idsError) throw idsError;

    const ids = (unreadIds as string[]) ?? [];
    if (ids.length === 0) return;

    // Create read records for all unread updates
    const readRecords = ids.map((updateId) => ({
      userId,
      updateId,
    })) as Sb.UserUpdateReadInsert[];

    const { error: insertError } = await sbDb
      .from("UserUpdateRead")
      .insert(readRecords);

    if (insertError) throw insertError;

    // Increment view count for all updates via bulk RPC
    const { error: rpcError } = await sbDb.rpc(
      "increment_update_view_count_bulk",
      { update_ids: ids }
    );

    if (rpcError) throw rpcError;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to mark all updates as read",
      additionalData: { userId, userRole },
      label: "Update",
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
  try {
    const { error } = await sbDb.rpc("increment_update_view_count", {
      update_id: updateId,
    });

    if (error) throw error;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to track update view",
      additionalData: { updateId },
      label: "Update",
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
  try {
    const { error } = await sbDb.rpc("increment_update_click_count", {
      update_id: updateId,
    });

    if (error) throw error;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to track update click",
      additionalData: { updateId },
      label: "Update",
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
  try {
    // Fetch the update
    const { data: update, error } = await sbDb
      .from("Update")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!update) return null;

    // Fetch createdBy user
    const { data: createdBy, error: userError } = await sbDb
      .from("User")
      .select("id, firstName, lastName")
      .eq("id", update.createdById)
      .single();

    if (userError) throw userError;

    // Fetch userReads for this update
    const { data: userReads, error: readsError } = await sbDb
      .from("UserUpdateRead")
      .select("*")
      .eq("updateId", id);

    if (readsError) throw readsError;

    return {
      ...update,
      createdBy,
      userReads: userReads ?? [],
      _count: {
        userReads: (userReads ?? []).length,
      },
    } as UpdateWithRelations;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get update by ID",
      additionalData: { id },
      label: "Update",
    });
  }
}

/**
 * Get all updates for admin dashboard with analytics
 */
export async function getAllUpdatesForAdmin(): Promise<UpdateWithRelations[]> {
  try {
    // Fetch all updates
    const { data: updates, error } = await sbDb
      .from("Update")
      .select("*")
      .order("publishDate", { ascending: false });

    if (error) throw error;

    if (!updates || updates.length === 0) return [];

    // Fetch all createdBy users in a single query
    const creatorIds = [...new Set(updates.map((u) => u.createdById))];
    const { data: creators, error: creatorsError } = await sbDb
      .from("User")
      .select("id, firstName, lastName")
      .in("id", creatorIds);

    if (creatorsError) throw creatorsError;

    const creatorsById = new Map((creators ?? []).map((c) => [c.id, c]));

    // Fetch all userReads in a single query
    const updateIds = updates.map((u) => u.id);
    const { data: allUserReads, error: readsError } = await sbDb
      .from("UserUpdateRead")
      .select("*")
      .in("updateId", updateIds);

    if (readsError) throw readsError;

    // Group userReads by updateId
    const readsByUpdateId = new Map<string, Sb.UserUpdateReadRow[]>();
    for (const read of allUserReads ?? []) {
      const existing = readsByUpdateId.get(read.updateId) ?? [];
      existing.push(read);
      readsByUpdateId.set(read.updateId, existing);
    }

    return updates.map((update) => {
      const userReads = readsByUpdateId.get(update.id) ?? [];
      const createdBy = creatorsById.get(update.createdById) ?? {
        id: update.createdById,
        firstName: null,
        lastName: null,
      };
      return {
        ...update,
        createdBy,
        userReads,
        _count: {
          userReads: userReads.length,
        },
      } as UpdateWithRelations;
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get all updates for admin",
      label: "Update",
    });
  }
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
  status = UpdateStatus.DRAFT,
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
    const { error } = await sbDb.from("Update").insert({
      title,
      content,
      url: url === undefined ? null : url,
      imageUrl: imageUrl === undefined ? null : imageUrl,
      publishDate: publishDate.toISOString(),
      status,
      targetRoles,
      createdById,
    } as Sb.UpdateInsert);

    if (error) throw error;
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
    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (url !== undefined) updateData.url = url;
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl;
    if (publishDate !== undefined)
      updateData.publishDate = publishDate.toISOString();
    if (status !== undefined) updateData.status = status;
    if (targetRoles !== undefined) updateData.targetRoles = targetRoles;

    const { error } = await sbDb
      .from("Update")
      .update(updateData as Sb.UpdateUpdate)
      .eq("id", id);

    if (error) throw error;
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
    const { error } = await sbDb.from("Update").delete().eq("id", id);

    if (error) throw error;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to delete update",
      additionalData: { id },
      label: "Update",
    });
  }
}
