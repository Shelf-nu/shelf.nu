import type { RenderableTreeNode } from "@markdoc/markdoc";
import type { OrganizationRoles, Prisma } from "@prisma/client";
import { UpdateStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

export type UpdateWithRelations = Prisma.UpdateGetPayload<{
  include: {
    createdBy: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
      };
    };
    userReads: true;
    _count: {
      select: {
        userReads: true;
      };
    };
  };
}>;

export type UpdateForUser = Prisma.UpdateGetPayload<{
  content: RenderableTreeNode;
  include: {
    userReads: {
      where: {
        userId: string;
      };
    };
  };
}>;

/**
 * Get all updates visible to a specific user based on their role
 */
export function getUpdatesForUser({
  userId,
  userRole,
}: {
  userId: string;
  userRole: OrganizationRoles;
}): Promise<UpdateForUser[]> {
  return db.update.findMany({
    where: {
      status: UpdateStatus.PUBLISHED,
      publishDate: {
        lte: new Date(),
      },
      OR: [
        // Updates with no role targeting (visible to all)
        {
          targetRoles: {
            isEmpty: true,
          },
        },
        // Updates that target the user's role
        {
          targetRoles: {
            has: userRole,
          },
        },
      ],
    },
    include: {
      userReads: {
        where: {
          userId,
        },
      },
    },
    orderBy: {
      publishDate: "desc",
    },
  });
}

/**
 * Get unread count for a user
 */
export function getUnreadCountForUser({
  userId,
  userRole,
}: {
  userId: string;
  userRole: OrganizationRoles;
}): Promise<number> {
  return db.update.count({
    where: {
      status: UpdateStatus.PUBLISHED,
      publishDate: {
        lte: new Date(),
      },
      OR: [
        // Updates with no role targeting (visible to all)
        {
          targetRoles: {
            isEmpty: true,
          },
        },
        // Updates that target the user's role
        {
          targetRoles: {
            has: userRole,
          },
        },
      ],
      NOT: {
        userReads: {
          some: {
            userId,
          },
        },
      },
    },
  });
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

  await db.userUpdateRead.upsert({
    where: {
      userId_updateId: {
        userId,
        updateId,
      },
    },
    create: {
      userId,
      updateId,
    },
    update: {
      readAt: new Date(),
    },
  });

  await db.update.update({
    where: { id: updateId },
    data: {
      viewCount: {
        increment: 1,
      },
    },
  });
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
  // Get all unread updates for the user
  const unreadUpdates = await db.update.findMany({
    where: {
      status: UpdateStatus.PUBLISHED,
      publishDate: {
        lte: new Date(),
      },
      OR: [
        {
          targetRoles: {
            isEmpty: true,
          },
        },
        {
          targetRoles: {
            has: userRole,
          },
        },
      ],
      NOT: {
        userReads: {
          some: {
            userId,
          },
        },
      },
    },
    select: {
      id: true,
    },
  });

  if (unreadUpdates.length === 0) return;

  // Mark all as read and increment view counts
  await db.$transaction(async (prisma) => {
    // Create read records for all unread updates
    await prisma.userUpdateRead.createMany({
      data: unreadUpdates.map((update) => ({
        userId,
        updateId: update.id,
      })),
    });

    // Increment view count for all updates
    await prisma.update.updateMany({
      where: {
        id: {
          in: unreadUpdates.map((update) => update.id),
        },
      },
      data: {
        viewCount: {
          increment: 1,
        },
      },
    });
  });
}

/**
 * Track view of an update (increment view count only)
 */
export async function trackUpdateView({
  updateId,
}: {
  updateId: string;
}): Promise<void> {
  await db.update.update({
    where: { id: updateId },
    data: {
      viewCount: {
        increment: 1,
      },
    },
  });
}

/**
 * Track click on an update (increment click count)
 */
export async function trackUpdateClick({
  updateId,
}: {
  updateId: string;
}): Promise<void> {
  await db.update.update({
    where: { id: updateId },
    data: {
      clickCount: {
        increment: 1,
      },
    },
  });
}

// ===== ADMIN FUNCTIONS =====

/**
 * Get a single update by ID for admin editing
 */
export function getUpdateById(id: string): Promise<UpdateWithRelations | null> {
  return db.update.findUnique({
    where: { id },
    include: {
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      userReads: true,
      _count: {
        select: {
          userReads: true,
        },
      },
    },
  });
}

/**
 * Get all updates for admin dashboard with analytics
 */
export function getAllUpdatesForAdmin(): Promise<UpdateWithRelations[]> {
  return db.update.findMany({
    include: {
      createdBy: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      userReads: true,
      _count: {
        select: {
          userReads: true,
        },
      },
    },
    orderBy: {
      publishDate: "desc",
    },
  });
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
    await db.update.create({
      data: {
        title,
        content,
        url: url === undefined ? null : url, // Convert undefined to null for database
        imageUrl: imageUrl === undefined ? null : imageUrl, // Convert undefined to null for database
        publishDate,
        status,
        targetRoles,
        createdById,
      },
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
    await db.update.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(content !== undefined && { content }),
        ...(url !== undefined && { url }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(publishDate !== undefined && { publishDate }),
        ...(status !== undefined && { status }),
        ...(targetRoles !== undefined && { targetRoles }),
      },
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
    await db.update.delete({
      where: { id },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to delete update",
      additionalData: { id },
      label: "Update",
    });
  }
}
