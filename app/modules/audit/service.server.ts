import type {
  User,
  Organization,
  AuditSession,
  AuditType,
  AuditStatus,
} from "@prisma/client";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Audit";

export type CreateAuditSessionPayload = {
  type: AuditType;
  targetId: string;
  userId: User["id"];
  organizationId: Organization["id"];
  expectedAssetCount: number;
};

export type UpdateAuditSessionPayload = {
  id: AuditSession["id"];
  foundAssetCount?: number;
  missingAssetCount?: number;
  unexpectedAssetCount?: number;
  organizationId: Organization["id"];
};

export type CompleteAuditSessionPayload = {
  id: AuditSession["id"];
  organizationId: Organization["id"];
};

/**
 * Creates a new audit session
 */
export async function createAuditSession(payload: CreateAuditSessionPayload) {
  const { type, targetId, userId, organizationId, expectedAssetCount } = payload;

  try {
    // Check if there's already an active audit session for this target
    const existingSession = await db.auditSession.findFirst({
      where: {
        type,
        targetId,
        organizationId,
        status: "ACTIVE",
      },
    });

    if (existingSession) {
      throw new ShelfError({
        cause: null,
        message: `An audit is already in progress for this ${type.toLowerCase()}`,
        additionalData: { existingSession },
        label,
      });
    }

    return await db.auditSession.create({
      data: {
        type,
        targetId,
        expectedAssetCount,
        createdById: userId,
        organizationId,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create audit session",
      additionalData: { payload },
      label,
    });
  }
}

/**
 * Updates an audit session with current counts
 */
export async function updateAuditSession(payload: UpdateAuditSessionPayload) {
  const { id, organizationId, ...updates } = payload;

  try {
    return await db.auditSession.update({
      where: {
        id,
        organizationId,
        status: "ACTIVE", // Only allow updates to active sessions
      },
      data: updates,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update audit session",
      additionalData: { payload },
      label,
    });
  }
}

/**
 * Completes an audit session
 */
export async function completeAuditSession(payload: CompleteAuditSessionPayload) {
  const { id, organizationId } = payload;

  try {
    return await db.auditSession.update({
      where: {
        id,
        organizationId,
        status: "ACTIVE",
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to complete audit session",
      additionalData: { payload },
      label,
    });
  }
}

/**
 * Cancels an audit session
 */
export async function cancelAuditSession(payload: CompleteAuditSessionPayload) {
  const { id, organizationId } = payload;

  try {
    return await db.auditSession.update({
      where: {
        id,
        organizationId,
        status: "ACTIVE",
      },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to cancel audit session",
      additionalData: { payload },
      label,
    });
  }
}

/**
 * Gets an active audit session for a target
 */
export async function getActiveAuditSession({
  type,
  targetId,
  organizationId,
}: {
  type: AuditType;
  targetId: string;
  organizationId: Organization["id"];
}) {
  try {
    return await db.auditSession.findFirst({
      where: {
        type,
        targetId,
        organizationId,
        status: "ACTIVE",
      },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get active audit session",
      additionalData: { type, targetId, organizationId },
      label,
    });
  }
}

/**
 * Gets audit session by ID
 */
export async function getAuditSession({
  id,
  organizationId,
}: {
  id: string;
  organizationId: Organization["id"];
}) {
  try {
    return await db.auditSession.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get audit session",
      additionalData: { id, organizationId },
      label,
    });
  }
}