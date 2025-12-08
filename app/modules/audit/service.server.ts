import { AuditAssignmentRole } from "@prisma/client";
import type { AuditAssignment, AuditSession } from "@prisma/client";
import type { UserOrganization } from "@prisma/client";

import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";

const label: ErrorLabel = "Audit";

export type AuditScopeMeta = {
  contextType?: string | null;
  contextName?: string | null;
};

export type CreateAuditSessionInput = {
  name: string;
  description?: string | null;
  assetIds: string[];
  organizationId: string;
  createdById: string;
  assigneeIds?: string[];
  scopeMeta?: AuditScopeMeta | null;
};

export type AuditExpectedAsset = {
  id: string;
  name: string;
};

export type CreateAuditSessionResult = {
  session: AuditSession & { assignments: AuditAssignment[] };
  expectedAssets: AuditExpectedAsset[];
};

export type GetAuditSessionResult = {
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
    scopeMeta,
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
        scopeMeta: scopeMeta ?? undefined,
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

export async function getAuditSessionDetails({
  id,
  organizationId,
  userOrganizations,
  request,
}: {
  id: AuditSession["id"];
  organizationId: string;
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}): Promise<GetAuditSessionResult> {
  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const session = await db.auditSession.findFirst({
      where: {
        OR: [
          { id, organizationId },
          ...(userOrganizations?.length
            ? [{ id, organizationId: { in: otherOrganizationIds } }]
            : []),
        ],
      },
      include: {
        assignments: true,
        assets: {
          include: {
            asset: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        },
      },
    });

    if (!session) {
      throw new ShelfError({
        cause: null,
        message: "Audit session not found",
        additionalData: { id, organizationId },
        status: 404,
        label,
      });
    }

    /* User is accessing the audit in the wrong organization. In that case we need special 404 handling. */
    if (
      userOrganizations?.length &&
      session.organizationId !== organizationId &&
      otherOrganizationIds?.includes(session.organizationId)
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "Audit not found",
        message: "",
        additionalData: {
          id,
          model: "audit",
          organization: userOrganizations.find(
            (org) => org.organizationId === session.organizationId
          ),
          redirectTo,
        },
        label,
        status: 404,
        shouldBeCaptured: false, // In this case we shouldn't be capturing the error
      });
    }

    const expectedAssets: AuditExpectedAsset[] = session.assets
      .filter((auditAsset) => auditAsset.expected && auditAsset.asset)
      .map((auditAsset) => ({
        id: auditAsset.assetId,
        name: auditAsset.asset?.title ?? "",
      }));

    return {
      session,
      expectedAssets,
    };
  } catch (cause) {
    // Re-throw special 404 errors without modification
    if (isLikeShelfError(cause) && cause.additionalData?.model === "audit") {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message: "Failed to load audit session",
      additionalData: { id, organizationId },
      label,
    });
  }
}
