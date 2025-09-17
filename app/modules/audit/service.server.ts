import type { AuditAssignment, AuditSession } from "@prisma/client";
import { AuditAssignmentRole } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Audit";

export type CreateAuditSessionInput = {
  name: string;
  description?: string | null;
  assetIds: string[];
  organizationId: string;
  createdById: string;
  assigneeIds?: string[];
};

export type AuditExpectedAsset = {
  id: string;
  name: string;
};

export type CreateAuditSessionResult = {
  session: AuditSession & { assignments: AuditAssignment[] };
  expectedAssets: AuditExpectedAsset[];
};

export async function createAuditSession(
  input: CreateAuditSessionInput
): Promise<CreateAuditSessionResult> {
  const {
    name,
    description,
    assetIds,
    organizationId,
    createdById,
    assigneeIds = [],
  } = input;

  const uniqueAssetIds = Array.from(new Set(assetIds));

  if (uniqueAssetIds.length === 0) {
    throw new ShelfError({
      cause: null,
      message: "You need to select at least one asset to start an audit.",
      label,
      additionalData: { organizationId, createdById },
      status: 400,
    });
  }

  const assets = await db.asset.findMany({
    where: {
      id: { in: uniqueAssetIds },
      organizationId,
    },
    select: {
      id: true,
      title: true,
    },
  });

  if (assets.length !== uniqueAssetIds.length) {
    throw new ShelfError({
      cause: null,
      message:
        "Some of the selected assets could not be found. Please refresh the page and try again.",
      label,
      additionalData: { organizationId, createdById, assetIds: uniqueAssetIds },
      status: 400,
    });
  }

  const uniqueAssigneeIds = Array.from(new Set([createdById, ...assigneeIds]));

  const result = await db.$transaction(async (tx) => {
    const session = await tx.auditSession.create({
      data: {
        name,
        description,
        organizationId,
        createdById,
        expectedAssetCount: assets.length,
        missingAssetCount: assets.length,
      },
    });

    if (assets.length > 0) {
      await tx.auditAsset.createMany({
        data: assets.map((asset) => ({
          auditSessionId: session.id,
          assetId: asset.id,
          expected: true,
        })),
      });
    }

    if (uniqueAssigneeIds.length > 0) {
      await tx.auditAssignment.createMany({
        data: uniqueAssigneeIds.map((userId) => ({
          auditSessionId: session.id,
          userId,
          role: userId === createdById ? AuditAssignmentRole.LEAD : undefined,
        })),
      });
    }

    const sessionWithAssignments = await tx.auditSession.findUnique({
      where: { id: session.id },
      include: {
        assignments: true,
      },
    });

    if (!sessionWithAssignments) {
      throw new ShelfError({
        cause: null,
        message: "Unable to load the newly created audit session.",
        label,
        additionalData: { sessionId: session.id },
      });
    }

    return {
      session: sessionWithAssignments,
      expectedAssets: assets.map((asset) => ({
        id: asset.id,
        name: asset.title,
      })),
    } satisfies CreateAuditSessionResult;
  });

  return result;
}
