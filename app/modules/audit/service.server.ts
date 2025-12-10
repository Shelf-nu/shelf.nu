import { AuditAssignmentRole } from "@prisma/client";
import { AuditAssetStatus } from "@prisma/client";
import { AuditStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
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
  session: AuditSession & {
    assignments: AuditAssignment[];
    createdBy: {
      id: string;
      firstName: string | null;
      lastName: string | null;
    };
  };
  expectedAssets: AuditExpectedAsset[];
};

/**
 * Input parameters for recording an audit scan.
 * Contains all necessary information to persist a scan event to the database.
 */
export type RecordAuditScanInput = {
  /** The ID of the audit session this scan belongs to */
  auditSessionId: string;
  /** The scanned QR code or barcode value */
  qrId: string;
  /** The ID of the asset that was scanned */
  assetId: string;
  /** Whether this asset was expected in the audit (true) or unexpected (false) */
  isExpected: boolean;
  /** The ID of the user who performed the scan */
  userId: string;
  /** The organization ID for security validation */
  organizationId: string;
};

/**
 * Result returned after successfully recording an audit scan.
 * Contains the scan ID and updated audit statistics.
 */
export type RecordAuditScanResult = {
  /** The ID of the newly created scan record */
  scanId: string;
  /** The ID of the associated audit asset record, if one exists */
  auditAssetId: string | null;
  /** Updated count of found assets in the audit */
  foundAssetCount: number;
  /** Updated count of unexpected assets in the audit */
  unexpectedAssetCount: number;
};

/**
 * Represents a single scan in an audit session.
 * Used when fetching existing scans to restore audit state.
 */
export type AuditScanData = {
  /** The QR code or barcode that was scanned */
  code: string;
  /** The ID of the asset that was scanned */
  assetId: string;
  /** The type of item scanned (currently only 'asset' is supported) */
  type: "asset" | "kit";
  /** When the scan occurred */
  scannedAt: Date;
  /** Whether this asset was expected in the audit */
  isExpected: boolean;
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
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
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

/**
 * Get paginated and filterable assets for an audit session.
 * Similar to getAssetsForKits but for audit expected assets.
 *
 * @param input - Contains audit session ID, organization ID, and request for search/pagination
 * @returns Paginated list of expected assets with full details
 */
export async function getAssetsForAuditSession({
  request,
  organizationId,
  auditSessionId,
}: {
  request: Request;
  organizationId: string;
  auditSessionId: string;
}) {
  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get("s") || null;

  try {
    // First get the expected asset IDs from the audit
    const auditAssets = await db.auditAsset.findMany({
      where: {
        auditSessionId,
        expected: true,
      },
      select: {
        assetId: true,
      },
    });

    const assetIds = auditAssets.map((aa) => aa.assetId);

    if (assetIds.length === 0) {
      return {
        page: 1,
        perPage: 0,
        items: [],
        totalItems: 0,
        totalPages: 0,
        search,
      };
    }

    // Build where clause
    const where: Prisma.AssetWhereInput = {
      organizationId,
      id: { in: assetIds },
    };

    // Apply search filter if provided
    if (search) {
      const searchTerm = search.toLowerCase().trim();
      where.OR = [
        { title: { contains: searchTerm, mode: "insensitive" } },
        {
          category: {
            name: { contains: searchTerm, mode: "insensitive" },
          },
        },
        {
          location: {
            name: { contains: searchTerm, mode: "insensitive" },
          },
        },
      ];
    }

    // Fetch assets with full details
    const assets = await db.asset.findMany({
      where,
      select: {
        id: true,
        title: true,
        mainImage: true,
        thumbnailImage: true,
        mainImageExpiration: true,
        status: true,
        availableToBook: true,
        category: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            parentId: true,
            _count: {
              select: {
                children: true,
              },
            },
          },
        },
      },
      orderBy: {
        title: "asc",
      },
    });

    const totalItems = assets.length;

    return {
      page: 1,
      perPage: totalItems,
      items: assets,
      totalItems,
      totalPages: 1,
      search,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to load assets for audit session",
      additionalData: { auditSessionId, organizationId },
      label,
    });
  }
}

/**
 * Records a scan in the audit session and updates the audit asset status.
 * This allows audits to be persisted and resumed across sessions.
 *
 * @param input - Contains audit session ID, QR code, asset ID, and whether asset was expected
 * @returns Scan ID and updated counts for the audit session
 */
export async function recordAuditScan(
  input: RecordAuditScanInput
): Promise<RecordAuditScanResult> {
  const { auditSessionId, qrId, assetId, isExpected, userId, organizationId } =
    input;

  try {
    // Verify the audit session exists and belongs to the organization
    const session = await db.auditSession.findFirst({
      where: {
        id: auditSessionId,
        organizationId,
      },
    });

    if (!session) {
      throw new ShelfError({
        cause: null,
        message: "Audit session not found",
        additionalData: { auditSessionId, organizationId },
        status: 404,
        label,
      });
    }

    // Check if this asset was already scanned in this audit
    const existingScan = await db.auditScan.findFirst({
      where: {
        auditSessionId,
        assetId,
      },
    });

    if (existingScan) {
      // Already scanned, just return current counts
      return {
        scanId: existingScan.id,
        auditAssetId: null,
        foundAssetCount: session.foundAssetCount,
        unexpectedAssetCount: session.unexpectedAssetCount,
      };
    }

    // Record the scan in a transaction
    const result = await db.$transaction(async (tx) => {
      // If this is the first scan and audit is still PENDING, activate it
      if (session.status === AuditStatus.PENDING) {
        await tx.auditSession.update({
          where: { id: auditSessionId },
          data: {
            status: AuditStatus.ACTIVE,
            startedAt: new Date(),
          },
        });
      }

      // Create the scan record
      const scan = await tx.auditScan.create({
        data: {
          auditSessionId,
          code: qrId,
          assetId,
          scannedById: userId,
          scannedAt: new Date(),
        },
      });

      let auditAssetId: string | null = null;

      // Update or create the audit asset record
      if (isExpected) {
        // Expected asset - update its status to FOUND
        await tx.auditAsset.updateMany({
          where: {
            auditSessionId,
            assetId,
            expected: true,
          },
          data: {
            status: AuditAssetStatus.FOUND,
            scannedAt: new Date(),
            scannedById: userId,
          },
        });

        // Get the audit asset ID for return
        const updatedAsset = await tx.auditAsset.findFirst({
          where: {
            auditSessionId,
            assetId,
            expected: true,
          },
          select: { id: true },
        });

        auditAssetId = updatedAsset?.id ?? null;
      } else {
        // Unexpected asset - create a new audit asset record
        const auditAsset = await tx.auditAsset.create({
          data: {
            auditSessionId,
            assetId,
            expected: false,
            status: AuditAssetStatus.UNEXPECTED,
            scannedAt: new Date(),
            scannedById: userId,
          },
        });
        auditAssetId = auditAsset.id;
      }

      // Update the audit session counts
      const updatedSession = await tx.auditSession.update({
        where: { id: auditSessionId },
        data: {
          foundAssetCount: isExpected
            ? { increment: 1 }
            : session.foundAssetCount,
          missingAssetCount: isExpected
            ? { decrement: 1 }
            : session.missingAssetCount,
          unexpectedAssetCount: !isExpected
            ? { increment: 1 }
            : session.unexpectedAssetCount,
        },
      });

      return {
        scanId: scan.id,
        auditAssetId,
        foundAssetCount: updatedSession.foundAssetCount,
        unexpectedAssetCount: updatedSession.unexpectedAssetCount,
      };
    });

    return result;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to record audit scan",
      additionalData: { auditSessionId, assetId, userId },
      label,
    });
  }
}

/**
 * Retrieves all scans for a given audit session.
 * Used to restore the audit state when resuming an audit.
 *
 * @param auditSessionId - The ID of the audit session
 * @param organizationId - The organization ID for security check
 * @returns Array of scan data with QR codes and asset IDs
 */
export async function getAuditScans({
  auditSessionId,
  organizationId,
}: {
  auditSessionId: string;
  organizationId: string;
}): Promise<AuditScanData[]> {
  try {
    // Verify the audit session exists and belongs to the organization
    const session = await db.auditSession.findFirst({
      where: {
        id: auditSessionId,
        organizationId,
      },
    });

    if (!session) {
      throw new ShelfError({
        cause: null,
        message: "Audit session not found",
        additionalData: { auditSessionId, organizationId },
        status: 404,
        label,
      });
    }

    const scans = await db.auditScan.findMany({
      where: { auditSessionId },
      include: {
        auditAsset: {
          select: {
            expected: true,
          },
        },
      },
      orderBy: { scannedAt: "asc" },
    });

    return scans.map((scan) => ({
      code: scan.code ?? "",
      assetId: scan.assetId ?? "",
      type: "asset" as const,
      scannedAt: scan.scannedAt,
      isExpected: scan.auditAsset?.expected ?? false,
    }));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch audit scans",
      additionalData: { auditSessionId, organizationId },
      label,
    });
  }
}

/**
 * Completes an audit session by finalizing all asset statuses.
 * Expected assets that were not scanned are marked as MISSING.
 * Updates the session status to COMPLETED and sets completedAt timestamp.
 *
 * @param input - Session ID, organization ID, and user ID
 */
export async function completeAuditSession({
  sessionId,
  organizationId,
  userId,
}: {
  sessionId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      // Verify session exists and belongs to organization
      const session = await tx.auditSession.findUnique({
        where: { id: sessionId, organizationId },
        select: { id: true, status: true },
      });

      if (!session) {
        throw new ShelfError({
          cause: null,
          message: "Audit session not found",
          additionalData: { sessionId, organizationId },
          status: 404,
          label,
        });
      }

      if (session.status === AuditStatus.COMPLETED) {
        throw new ShelfError({
          cause: null,
          message: "Audit session is already completed",
          additionalData: { sessionId },
          status: 400,
          label,
        });
      }

      // Mark all expected assets that weren't scanned as MISSING
      await tx.auditAsset.updateMany({
        where: {
          auditSessionId: sessionId,
          expected: true,
          status: "PENDING",
        },
        data: {
          status: "MISSING",
        },
      });

      // Count missing assets
      const missingCount = await tx.auditAsset.count({
        where: {
          auditSessionId: sessionId,
          status: "MISSING",
        },
      });

      // Update session to completed
      await tx.auditSession.update({
        where: { id: sessionId },
        data: {
          status: AuditStatus.COMPLETED,
          completedAt: new Date(),
          missingAssetCount: missingCount,
        },
      });
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to complete audit session",
      additionalData: { sessionId, organizationId, userId },
      label,
    });
  }
}
