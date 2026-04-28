import { AuditAssetStatus } from "@prisma/client";
import { AuditStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type {
  AuditAssignment,
  AuditSession,
  Organization,
} from "@prisma/client";
import type { UserOrganization } from "@prisma/client";
import { z } from "zod";

import type { SortingDirection } from "~/components/list/filters/sort-by";
import { db } from "~/database/db.server";
import {
  createAssetNotesForAuditAddition,
  createAssetNotesForAuditRemoval,
} from "~/modules/note/service.server";
import type { ClientHint } from "~/utils/client-hints";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { wrapUserLinkForNote } from "~/utils/markdoc-wrappers";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { removePublicFile } from "~/utils/storage.server";

import type { AuditFilterType } from "./audit-filter-utils";
import {
  sendAuditCancelledEmails,
  sendAuditCompletedEmail,
} from "./email-helpers";
import {
  createAssetScanNote,
  createAuditCreationNote,
  createAuditStartedNote,
  createAuditCompletedNote,
  createAuditUpdateNote,
  createDueDateChangedNote,
  createAssigneeAddedNote,
  createAssigneeRemovedNote,
  createAssetsAddedToAuditNote,
  createAssetRemovedFromAuditNote,
  createAssetsRemovedFromAuditNote,
} from "./helpers.server";
import type { AuditSchedulerData } from "./types";
import { TAG_WITH_COLOR_SELECT } from "../tag/constants";
const label: ErrorLabel = "Audit";

/**
 * Rejects writes against archived audits.
 * Call immediately after loading the session in every mutating service
 * so the archive/read-only contract is enforced server-side.
 */
function assertAuditNotArchived(
  status: AuditStatus,
  details: { auditSessionId: string; organizationId: string }
) {
  if (status === AuditStatus.ARCHIVED) {
    throw new ShelfError({
      cause: null,
      message: "Archived audits are read-only.",
      additionalData: details,
      label,
      status: 400,
    });
  }
}

export const AUDIT_LIST_INCLUDE = {
  createdBy: {
    select: {
      firstName: true,
      lastName: true,
      displayName: true,
      email: true,
      profilePicture: true,
    },
  },
  assignments: {
    include: {
      user: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
          email: true,
          profilePicture: true,
        },
      },
    },
  },
  _count: {
    select: {
      assets: true,
      scans: true,
      assignments: true,
    },
  },
} satisfies Prisma.AuditSessionInclude;

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
  assignee?: string;
  scopeMeta?: AuditScopeMeta | null;
  dueDate?: Date;
};

export type AuditExpectedAsset = {
  id: string;
  name: string;
  auditAssetId: string;
  auditNotesCount?: number;
  auditImagesCount?: number;
  mainImage?: string | null;
  thumbnailImage?: string | null;
  locationName?: string | null;
};

export type CreateAuditSessionResult = {
  session: AuditSession & { assignments: AuditAssignment[] };
  expectedAssets: AuditExpectedAsset[];
};

export type GetAuditSessionResult = {
  session: AuditSession & {
    assignments: (AuditAssignment & {
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        email: string;
        profilePicture: string | null;
      };
    })[];
    createdBy: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      email: string;
      profilePicture: string | null;
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
  /** Asset title for display */
  assetTitle: string;
  /** The audit asset ID for notes/images */
  auditAssetId: string | null;
  /** Number of notes on this audit asset */
  auditNotesCount: number;
  /** Number of images on this audit asset */
  auditImagesCount: number;
  /** Asset location name for display */
  assetLocationName: string | null;
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
    assignee,
    scopeMeta,
    dueDate,
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

  // Only add assignees who are explicitly selected
  // Creator is NOT automatically added as an assignee
  const uniqueAssigneeIds = assignee ? [assignee] : [];

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
        dueDate,
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
          // LEAD role is reserved for future use (e.g., when we support multiple assignees)
          role: undefined,
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

    // Create automatic note for audit creation
    await createAuditCreationNote({
      auditSessionId: session.id,
      createdById,
      expectedAssetCount: assets.length,
      tx,
    });

    // Fetch the created audit assets to get their IDs
    const createdAuditAssets = await tx.auditAsset.findMany({
      where: {
        auditSessionId: session.id,
        expected: true,
      },
      select: {
        id: true,
        assetId: true,
      },
    });

    // Create a map for quick lookup
    const auditAssetMap = new Map(
      createdAuditAssets.map((aa) => [aa.assetId, aa.id])
    );

    return {
      session: sessionWithAssignments,
      expectedAssets: assets.map((asset) => ({
        id: asset.id,
        name: asset.title,
        auditAssetId: auditAssetMap.get(asset.id) ?? "",
      })),
    } satisfies CreateAuditSessionResult;
  });

  // Create asset notes outside the transaction
  if (assets.length > 0) {
    await createAssetNotesForAuditAddition({
      assetIds: assets.map((a) => a.id),
      userId: createdById,
      audit: {
        id: result.session.id,
        name: result.session.name,
      },
    });
  }

  return result;
}

/**
 * Updates an audit session's details (name, description, due date, and/or assignee).
 * Creates automatic notes for tracked changes.
 * Optimized to perform minimal database queries.
 */
export async function updateAuditSession({
  id,
  organizationId,
  userId,
  data,
}: {
  id: string;
  organizationId: string;
  userId: string;
  data: {
    name?: string;
    description?: string | null;
    dueDate?: Date | null;
    assigneeUserId?: string | null;
  };
}) {
  // Use transaction to ensure atomicity
  return db.$transaction(async (tx) => {
    // Fetch the current audit to track changes
    const currentAudit = await tx.auditSession.findUnique({
      where: { id, organizationId },
      select: {
        name: true,
        description: true,
        status: true,
        dueDate: true,
        assignments: {
          select: {
            userId: true,
          },
        },
      },
    });

    if (!currentAudit) {
      throw new ShelfError({
        cause: null,
        message: "Audit not found",
        additionalData: { id, organizationId },
        label: "Audit",
        status: 404,
      });
    }

    assertAuditNotArchived(currentAudit.status, {
      auditSessionId: id,
      organizationId,
    });

    if (currentAudit.status === AuditStatus.CANCELLED) {
      throw new ShelfError({
        cause: null,
        message: "Cancelled audits cannot be edited.",
        additionalData: { id, organizationId },
        label: "Audit",
        status: 400,
      });
    }

    if (currentAudit.status === AuditStatus.COMPLETED) {
      throw new ShelfError({
        cause: null,
        message: "Completed audits cannot be edited.",
        additionalData: { id, organizationId },
        label: "Audit",
        status: 400,
      });
    }

    // Track what changed for activity logging
    const changes: Array<{ field: string; from: string; to: string }> = [];
    const currentAssignee = currentAudit.assignments[0]?.userId || null;
    const newAssignee =
      data.assigneeUserId === undefined
        ? undefined
        : data.assigneeUserId || null;

    // Track basic field changes
    if (data.name !== undefined && data.name !== currentAudit.name) {
      changes.push({
        field: "name",
        from: currentAudit.name,
        to: data.name,
      });
    }

    if (
      data.description !== undefined &&
      data.description !== currentAudit.description
    ) {
      changes.push({
        field: "description",
        from: currentAudit.description || "(empty)",
        to: data.description || "(empty)",
      });
    }

    // Check if due date changed
    const dueDateChanged =
      data.dueDate !== undefined &&
      ((currentAudit.dueDate === null && data.dueDate !== null) ||
        (currentAudit.dueDate !== null && data.dueDate === null) ||
        (currentAudit.dueDate !== null &&
          data.dueDate !== null &&
          currentAudit.dueDate.getTime() !== data.dueDate.getTime()));

    // Check if assignee changed
    const assigneeChanged =
      newAssignee !== undefined && newAssignee !== currentAssignee;

    // Single update for all audit session fields
    const updatedAudit = await tx.auditSession.update({
      where: { id, organizationId },
      data: {
        name: data.name,
        description: data.description,
        dueDate: data.dueDate,
      },
    });

    // Single batch operation for assignee changes
    if (assigneeChanged) {
      // Remove old assignee if exists
      if (currentAssignee) {
        await tx.auditAssignment.deleteMany({
          where: { auditSessionId: id, userId: currentAssignee },
        });
      }
      // Add new assignee if provided
      if (newAssignee) {
        await tx.auditAssignment.create({
          data: { auditSessionId: id, userId: newAssignee },
        });
      }
    }

    // Create all activity notes in batch (minimize DB round trips)
    const notePromises: Promise<any>[] = [];

    // Basic field changes note
    if (changes.length > 0) {
      notePromises.push(
        createAuditUpdateNote({
          auditSessionId: id,
          userId,
          changes,
          tx,
        })
      );
    }

    // Due date change note
    if (dueDateChanged) {
      notePromises.push(
        createDueDateChangedNote({
          auditSessionId: id,
          userId,
          oldDate: currentAudit.dueDate,
          newDate: data.dueDate!,
          tx,
        })
      );
    }

    // Assignee change notes
    if (assigneeChanged) {
      if (currentAssignee) {
        notePromises.push(
          createAssigneeRemovedNote({
            auditSessionId: id,
            userId,
            assigneeUserId: currentAssignee,
            tx,
          })
        );
      }
      if (newAssignee) {
        notePromises.push(
          createAssigneeAddedNote({
            auditSessionId: id,
            userId,
            assigneeUserId: newAssignee,
            tx,
          })
        );
      }
    }

    // Execute all note creations in parallel
    if (notePromises.length > 0) {
      await Promise.all(notePromises);
    }

    return updatedAudit;
  });
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
        assignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                email: true,
                profilePicture: true,
              },
            },
          },
        },
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
            profilePicture: true,
          },
        },
        assets: {
          include: {
            asset: {
              select: {
                id: true,
                title: true,
                mainImage: true,
                thumbnailImage: true,
                location: {
                  select: {
                    name: true,
                  },
                },
              },
            },
            _count: {
              select: {
                notes: {
                  where: { type: "COMMENT" },
                },
                images: true,
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
        auditAssetId: auditAsset.id, // ID of the AuditAsset record (for notes/images)
        auditNotesCount: auditAsset._count?.notes ?? 0,
        auditImagesCount: auditAsset._count?.images ?? 0,
        mainImage: auditAsset.asset?.mainImage ?? null,
        thumbnailImage: auditAsset.asset?.thumbnailImage ?? null,
        locationName: auditAsset.asset?.location?.name ?? null,
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
 * Schedule the next audit reminder job using PgBoss scheduler
 * This follows the same pattern as booking reminders
 */
export async function scheduleNextAuditJob({
  data,
  when,
}: {
  data: AuditSchedulerData;
  when: Date;
}) {
  try {
    const id = await scheduler.sendAfter(QueueNames.auditQueue, data, {}, when);
    if (id) {
      await db.auditSession.update({
        where: { id: data.id },
        data: { activeSchedulerReference: id },
      });
    }
    Logger.info(
      `Scheduled audit job: ${data.eventType} for audit ${
        data.id
      } at ${when.toISOString()}`
    );
    return id;
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to schedule audit job",
        additionalData: { data, when },
        label: "Audit",
      })
    );
    throw cause;
  }
}

/**
 * Cancel all scheduled reminder jobs for an audit
 * Should be called when audit is completed or cancelled
 */
async function cancelAuditReminders(auditId: string) {
  try {
    const auditSession = await db.auditSession.findUnique({
      where: { id: auditId },
      select: { activeSchedulerReference: true },
    });

    if (!auditSession?.activeSchedulerReference) {
      Logger.info(
        `Skipping audit reminder cancellation for audit ${auditId} because no activeSchedulerReference was found.`
      );
      return;
    }

    await scheduler.cancel(auditSession.activeSchedulerReference);
    await db.auditSession.update({
      where: { id: auditId },
      data: { activeSchedulerReference: null },
    });
    Logger.info(`Cancelled all reminder jobs for audit ${auditId}`);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to cancel audit reminder jobs",
        additionalData: { auditId },
        label: "Audit",
      })
    );
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

  // Validate audit status with Zod schema
  // Extract all possible filter values from AuditFilterType
  const filterValues: [AuditFilterType, ...AuditFilterType[]] = [
    "ALL",
    "EXPECTED",
    "FOUND",
    "MISSING",
    "UNEXPECTED",
  ];

  const auditStatusSchema = z.object({
    auditStatus: z.enum(filterValues).optional(),
  });

  const { auditStatus } = auditStatusSchema.parse({
    auditStatus: searchParams.get("auditStatus") || "ALL",
  });

  try {
    // Build where clause for audit assets based on status filter
    const auditAssetWhere: Prisma.AuditAssetWhereInput = {
      auditSessionId,
    };

    // Apply status filter
    if (auditStatus && auditStatus !== "ALL") {
      switch (auditStatus) {
        case "EXPECTED":
          // Assets that are expected in the audit
          auditAssetWhere.expected = true;
          break;
        case "FOUND":
          // Assets that were found (scanned)
          auditAssetWhere.status = AuditAssetStatus.FOUND;
          break;
        case "MISSING":
          // Assets that are expected but not found
          // During active audits, unscanned assets have PENDING status;
          // after completion they become MISSING.
          auditAssetWhere.expected = true;
          auditAssetWhere.status = {
            in: [AuditAssetStatus.MISSING, AuditAssetStatus.PENDING],
          };
          break;
        case "UNEXPECTED":
          // Assets that were scanned but not expected
          auditAssetWhere.expected = false;
          auditAssetWhere.status = AuditAssetStatus.UNEXPECTED;
          break;
      }
    }
    // If auditStatus is "ALL" or not provided, no filter is applied
    // This shows all assets (expected + unexpected)

    // Get the filtered audit assets
    const auditAssets = await db.auditAsset.findMany({
      where: auditAssetWhere,
      select: {
        id: true,
        assetId: true,
        expected: true,
        status: true,
      },
    });

    const assetIds = auditAssets.map((aa) => aa.assetId);

    // Create lookup map for audit status data
    const auditStatusMap = new Map(
      auditAssets.map((aa) => [
        aa.assetId,
        {
          auditAssetId: aa.id,
          expected: aa.expected,
          auditStatus: aa.status,
        },
      ])
    );

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
        category: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
        tags: TAG_WITH_COLOR_SELECT,
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
        custody: {
          select: {
            custodian: {
              select: {
                id: true,
                name: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    displayName: true,
                    email: true,
                    profilePicture: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        title: "asc",
      },
    });

    // Enrich assets with audit status data for "ALL" filter
    const enrichedAssets = assets.map((asset) => ({
      ...asset,
      auditData: auditStatusMap.get(asset.id) || null,
    }));

    const totalItems = assets.length;

    return {
      page: 1,
      perPage: totalItems,
      items: enrichedAssets,
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

    assertAuditNotArchived(session.status, {
      auditSessionId,
      organizationId,
    });

    // Check if this asset was already scanned in this audit
    const existingScan = await db.auditScan.findFirst({
      where: {
        auditSessionId,
        assetId,
      },
      select: {
        id: true,
        auditAssetId: true,
      },
    });

    if (existingScan) {
      // Already scanned, just return current counts
      return {
        scanId: existingScan.id,
        auditAssetId: existingScan.auditAssetId,
        foundAssetCount: session.foundAssetCount,
        unexpectedAssetCount: session.unexpectedAssetCount,
      };
    }

    // Pre-fetch user and asset data for note creation outside the transaction
    const [scannerUser, scannedAsset] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        },
      }),
      db.asset.findUnique({
        where: { id: assetId },
        select: { id: true, title: true },
      }),
    ]);

    // Record the scan in a transaction
    const result = await db.$transaction(
      async (tx) => {
        // If this is the first scan and audit is still PENDING, activate it
        if (session.status === AuditStatus.PENDING) {
          await tx.auditSession.update({
            where: { id: auditSessionId },
            data: {
              status: AuditStatus.ACTIVE,
              startedAt: new Date(),
            },
          });

          // Create automatic note for audit being started
          await createAuditStartedNote({
            auditSessionId,
            userId,
            tx,
            prefetchedUser: scannerUser,
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

        // Link the scan to the audit asset so we can query it later
        if (auditAssetId) {
          await tx.auditScan.update({
            where: { id: scan.id },
            data: { auditAssetId },
          });
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

        // Create automatic note for asset scan using pre-fetched data
        await createAssetScanNote({
          auditSessionId,
          assetId,
          userId,
          isExpected,
          tx,
          prefetchedUser: scannerUser,
          prefetchedAsset: scannedAsset,
        });

        return {
          scanId: scan.id,
          auditAssetId,
          foundAssetCount: updatedSession.foundAssetCount,
          unexpectedAssetCount: updatedSession.unexpectedAssetCount,
        };
      },
      { timeout: 15000 }
    );

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
        asset: {
          select: {
            id: true,
            title: true,
            location: {
              select: {
                name: true,
              },
            },
          },
        },
        auditAsset: {
          select: {
            id: true,
            expected: true,
            _count: {
              select: {
                notes: {
                  where: { type: "COMMENT" },
                },
                images: true,
              },
            },
          },
        },
      },
      orderBy: { scannedAt: "asc" },
    });

    // For scans without auditAsset relation (created before the fix that links them),
    // look up AuditAsset by assetId
    const assetIdsWithoutLink = scans
      .filter((s) => !s.auditAsset && s.assetId)
      .map((s) => s.assetId as string);

    const auditAssetsByAssetId = new Map<
      string,
      {
        id: string;
        expected: boolean;
        _count: { notes: number; images: number };
      }
    >();

    if (assetIdsWithoutLink.length > 0) {
      const auditAssets = await db.auditAsset.findMany({
        where: {
          auditSessionId,
          assetId: { in: assetIdsWithoutLink },
        },
        select: {
          id: true,
          assetId: true,
          expected: true,
          _count: {
            select: {
              notes: {
                where: { type: "COMMENT" },
              },
              images: true,
            },
          },
        },
      });

      for (const aa of auditAssets) {
        if (aa.assetId) {
          auditAssetsByAssetId.set(aa.assetId, {
            id: aa.id,
            expected: aa.expected,
            _count: aa._count,
          });
        }
      }
    }

    return scans.map((scan) => {
      // Use direct relation if available, otherwise fall back to lookup by assetId
      const auditAsset =
        scan.auditAsset ??
        (scan.assetId ? auditAssetsByAssetId.get(scan.assetId) : undefined);

      return {
        code: scan.code ?? "",
        assetId: scan.assetId ?? "",
        type: "asset" as const,
        scannedAt: scan.scannedAt,
        isExpected: auditAsset?.expected ?? false,
        assetTitle: scan.asset?.title ?? "",
        auditAssetId: auditAsset?.id ?? null,
        auditNotesCount: auditAsset?._count?.notes ?? 0,
        auditImagesCount: auditAsset?._count?.images ?? 0,
        assetLocationName: scan.asset?.location?.name ?? null,
      };
    });
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
  completionNote,
  hints,
}: {
  sessionId: string;
  organizationId: string;
  userId: string;
  completionNote?: string;
  hints: ClientHint;
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

      assertAuditNotArchived(session.status, {
        auditSessionId: sessionId,
        organizationId,
      });

      if (
        session.status === AuditStatus.COMPLETED ||
        session.status === AuditStatus.CANCELLED
      ) {
        throw new ShelfError({
          cause: null,
          message:
            session.status === AuditStatus.COMPLETED
              ? "Audit session is already completed"
              : "Cancelled audits cannot be completed.",
          additionalData: { sessionId, status: session.status },
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

      // Get all counts for completion note
      const [expectedCount, foundCount, missingCount, unexpectedCount] =
        await Promise.all([
          tx.auditAsset.count({
            where: {
              auditSessionId: sessionId,
              expected: true,
            },
          }),
          tx.auditAsset.count({
            where: {
              auditSessionId: sessionId,
              status: "FOUND",
            },
          }),
          tx.auditAsset.count({
            where: {
              auditSessionId: sessionId,
              status: "MISSING",
            },
          }),
          tx.auditAsset.count({
            where: {
              auditSessionId: sessionId,
              expected: false,
            },
          }),
        ]);

      // Update session to completed
      await tx.auditSession.update({
        where: { id: sessionId },
        data: {
          status: AuditStatus.COMPLETED,
          completedAt: new Date(),
          missingAssetCount: missingCount,
        },
      });

      // Create automatic completion note with stats and optional user message
      await createAuditCompletedNote({
        auditSessionId: sessionId,
        userId,
        expectedCount,
        foundCount,
        missingCount,
        unexpectedCount,
        completionNote,
        tx,
      });
    });

    // Fetch full audit details for email notification
    const completedAudit = await db.auditSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        name: true,
        description: true,
        dueDate: true,
        completedAt: true,
        organizationId: true,
        organization: {
          select: {
            name: true,
            customEmailFooter: true,
            owner: {
              select: { email: true },
            },
          },
        },
        _count: {
          select: { assets: true },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        assignments: {
          include: {
            user: {
              select: {
                email: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    if (completedAudit && completedAudit.completedAt) {
      // Calculate if audit was overdue
      const wasOverdue =
        completedAudit.dueDate &&
        completedAudit.completedAt > completedAudit.dueDate;

      // Get assignees to notify (exclude the user who completed it)
      // Normalize assignments to email payload shape to allow creator injection.
      const assigneesToNotify = completedAudit.assignments
        .filter((assignment) => assignment.user.email)
        .map((assignment) => ({
          userId: assignment.userId,
          user: assignment.user,
        }));

      // Always notify the audit creator even if they are not an assignee.
      if (
        completedAudit.createdBy.email &&
        !assigneesToNotify.some(
          (assignment) => assignment.userId === completedAudit.createdBy.id
        )
      ) {
        assigneesToNotify.push({
          userId: completedAudit.createdBy.id,
          user: {
            email: completedAudit.createdBy.email,
            firstName: completedAudit.createdBy.firstName,
            lastName: completedAudit.createdBy.lastName,
            displayName: completedAudit.createdBy.displayName,
          },
        });
      }

      // Send completion email
      sendAuditCompletedEmail({
        audit: completedAudit,
        assigneesToNotify,
        hints,
        completedAt: completedAudit.completedAt,
        wasOverdue: Boolean(wasOverdue),
      });
    }

    // Cancel all scheduled reminder jobs
    await cancelAuditReminders(sessionId);
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Failed to complete audit session",
      additionalData: { sessionId, organizationId, userId },
      label,
      shouldBeCaptured: isShelfError ? cause.shouldBeCaptured : undefined,
    });
  }
}

/**
 * Get all audits for an organization with pagination and search
 */
export async function getAuditsForOrganization(params: {
  organizationId: AuditSession["organizationId"];
  userId?: string;
  isSelfServiceOrBase?: boolean;
  /** Page number. Starts at 1 */
  page?: number;
  /** Items to be loaded per page */
  perPage?: number;
  search?: string | null;
  /** Filter by status */
  status?: AuditStatus | null;
  /** Field to sort by */
  orderBy?: string;
  /** Sort direction */
  orderDirection?: SortingDirection;
}) {
  const {
    organizationId,
    userId,
    isSelfServiceOrBase,
    page = 1,
    perPage = 8,
    search,
    status,
    orderBy = "createdAt",
    orderDirection = "desc",
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 ? perPage : 8;

    const where: Prisma.AuditSessionWhereInput = { organizationId };

    // Filter by assignee for BASE/SELF_SERVICE users
    if (isSelfServiceOrBase && userId) {
      where.assignments = {
        some: {
          userId,
        },
      };
    }

    // Add search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    // Add status filter — exclude ARCHIVED by default when no filter is set
    if (status) {
      where.status = status;
    } else {
      where.status = { notIn: [AuditStatus.ARCHIVED] };
    }

    const [audits, totalAudits] = await Promise.all([
      db.auditSession.findMany({
        skip,
        take,
        where,
        orderBy: { [orderBy]: orderDirection },
        include: AUDIT_LIST_INCLUDE,
      }),
      db.auditSession.count({ where }),
    ]);

    return { audits, totalAudits };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching audits. Please try again or contact support.",
      additionalData: { organizationId },
      label,
    });
  }
}

/**
 * Validates that the user is assigned to the audit session.
 * Throws a 403 ShelfError if the user is not an assignee.
 *
 * When isSelfServiceOrBase is false (admin/owner), allows the user to perform
 * actions if the audit has no assignees.
 *
 * @throws {ShelfError} 403 error if user is not an assignee
 */
export async function requireAuditAssignee({
  auditSessionId,
  organizationId,
  userId,
  request,
  isSelfServiceOrBase = true,
}: {
  auditSessionId: string;
  organizationId: string;
  userId: string;
  request?: Request;
  /** When true, always require assignee. When false (admin/owner), allow if no assignees. */
  isSelfServiceOrBase?: boolean;
}): Promise<void> {
  const { session } = await getAuditSessionDetails({
    id: auditSessionId,
    organizationId,
    userOrganizations: [],
    request,
  });

  const hasNoAssignees = session.assignments.length === 0;
  const isAdminOrOwner = !isSelfServiceOrBase;

  // Allow admin/owner to perform actions if audit has no assignees
  if (isAdminOrOwner && hasNoAssignees) {
    return;
  }

  const isAssignee = session.assignments.some(
    (assignment) => assignment.userId === userId
  );

  if (!isAssignee) {
    throw new ShelfError({
      cause: null,
      message:
        "Only users assigned to this audit can perform this action. Please contact the audit creator to be assigned.",
      additionalData: { auditSessionId, userId },
      status: 403,
      label,
    });
  }
}

/**
 * Validates that a BASE/SELF_SERVICE user is assigned to an audit.
 * For ADMIN/OWNER users, this check is skipped (they can access all audits).
 *
 * @throws {ShelfError} If BASE/SELF_SERVICE user is not assigned to the audit
 */
export function requireAuditAssigneeForBaseSelfService({
  audit,
  userId,
  isSelfServiceOrBase,
  auditId,
}: {
  audit: { assignments: { userId: string }[] };
  userId: string;
  isSelfServiceOrBase: boolean;
  auditId: string;
}) {
  if (isSelfServiceOrBase) {
    const isAssignee = audit.assignments.some(
      (assignment) => assignment.userId === userId
    );

    if (!isAssignee) {
      throw new ShelfError({
        cause: null,
        title: "Unauthorized",
        message: "You don't have permission to view this audit",
        additionalData: { auditId, userId },
        status: 403,
        label,
        shouldBeCaptured: false,
      });
    }
  }
}

/**
 * Cancels an audit session
 * Only the creator can cancel an audit
 * Cannot cancel if audit is already COMPLETED or CANCELLED
 */
export async function cancelAuditSession({
  auditSessionId,
  organizationId,
  userId,
  hints,
}: {
  auditSessionId: string;
  organizationId: string;
  userId: string;
  hints: ClientHint;
}) {
  try {
    // Fetch audit session with creator and assignee info
    const auditSession = await db.auditSession.findUnique({
      where: { id: auditSessionId, organizationId },
      include: {
        createdBy: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            displayName: true,
          },
        },
        organization: {
          include: {
            owner: {
              select: { email: true },
            },
          },
        },
        assignments: {
          include: {
            user: {
              select: {
                email: true,
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
        _count: {
          select: { assets: true },
        },
      },
    });

    if (!auditSession) {
      throw new ShelfError({
        cause: null,
        message: "Audit not found",
        additionalData: { auditSessionId, organizationId },
        label,
        status: 404,
      });
    }

    assertAuditNotArchived(auditSession.status, {
      auditSessionId,
      organizationId,
    });

    // Check if user is the creator
    if (auditSession.createdById !== userId) {
      throw new ShelfError({
        cause: null,
        message: "Only the audit creator can cancel the audit",
        additionalData: {
          auditSessionId,
          userId,
          creatorId: auditSession.createdById,
        },
        label,
        status: 403,
      });
    }

    // Check if audit can be cancelled
    if (
      auditSession.status === AuditStatus.COMPLETED ||
      auditSession.status === AuditStatus.CANCELLED
    ) {
      throw new ShelfError({
        cause: null,
        message: `Cannot cancel an audit that is already ${auditSession.status.toLowerCase()}`,
        additionalData: { auditSessionId, status: auditSession.status },
        label,
        status: 400,
      });
    }

    // Update audit status to CANCELLED
    const updatedAudit = await db.auditSession.update({
      where: { id: auditSessionId },
      data: { status: AuditStatus.CANCELLED, cancelledAt: new Date() },
    });

    // Fetch acting user's info for the activity note
    const actingUser = await db.user.findFirst({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });

    // Create activity note for cancellation
    await db.auditNote.create({
      data: {
        content: `${wrapUserLinkForNote({
          id: userId,
          firstName: actingUser?.firstName,
          lastName: actingUser?.lastName,
        })} cancelled the audit`,
        type: "UPDATE",
        userId,
        auditSessionId,
      },
    });

    // Send cancellation email to assignees (excluding creator)
    const assigneesToNotify = auditSession.assignments.filter(
      (assignment) => assignment.userId !== userId && assignment.user.email
    );

    // Use email helper to send cancellation emails with HTML template
    sendAuditCancelledEmails({
      audit: auditSession,
      assigneesToNotify,
      hints,
    });

    // Cancel all scheduled reminder jobs
    await cancelAuditReminders(auditSessionId);

    return updatedAudit;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while cancelling the audit.",
      additionalData: isShelfError
        ? cause.additionalData
        : { auditSessionId, organizationId, userId },
      label,
    });
  }
}

/**
 * Fetches all pending audits for an organization.
 * Used in the "Add to existing audit" bulk action selector.
 */
export async function getPendingAuditsForOrganization({
  organizationId,
}: {
  organizationId: string;
}) {
  return db.auditSession.findMany({
    where: {
      organizationId,
      status: AuditStatus.PENDING,
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      expectedAssetCount: true,
      createdBy: {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
      assignments: {
        select: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Adds assets to an existing pending audit.
 * Skips assets that are already in the audit.
 * Creates automatic activity note with counts.
 */
export async function addAssetsToAudit({
  auditId,
  assetIds,
  organizationId,
  userId,
}: {
  auditId: string;
  assetIds: string[];
  organizationId: string;
  userId: string;
}): Promise<{
  addedCount: number;
  skippedCount: number;
}> {
  return db
    .$transaction(async (tx) => {
      // Verify audit exists and is PENDING
      const audit = await tx.auditSession.findUnique({
        where: { id: auditId, organizationId },
        select: { id: true, name: true, status: true },
      });

      if (!audit) {
        throw new ShelfError({
          cause: null,
          message: "Audit not found",
          additionalData: { auditId, organizationId },
          label,
          status: 404,
        });
      }

      if (audit.status !== AuditStatus.PENDING) {
        throw new ShelfError({
          cause: null,
          message: "Can only add assets to pending audits",
          additionalData: { auditId, status: audit.status },
          label,
          status: 400,
        });
      }

      // Fetch existing audit assets to filter out duplicates
      const existingAuditAssets = await tx.auditAsset.findMany({
        where: {
          auditSessionId: auditId,
          assetId: { in: assetIds },
        },
        select: { assetId: true },
      });

      const existingAssetIds = new Set(
        existingAuditAssets.map((aa) => aa.assetId)
      );

      // Filter out assets already in audit
      const newAssetIds = assetIds.filter((id) => !existingAssetIds.has(id));

      // Create new audit asset entries
      if (newAssetIds.length > 0) {
        await tx.auditAsset.createMany({
          data: newAssetIds.map((assetId) => ({
            auditSessionId: auditId,
            assetId,
            expected: true,
            status: AuditAssetStatus.PENDING,
          })),
        });

        // Update audit session counts
        await tx.auditSession.update({
          where: { id: auditId },
          data: {
            expectedAssetCount: { increment: newAssetIds.length },
            missingAssetCount: { increment: newAssetIds.length },
          },
        });
      }

      const addedCount = newAssetIds.length;
      const skippedCount = assetIds.length - addedCount;

      // Create activity note with asset details
      if (addedCount > 0) {
        await createAssetsAddedToAuditNote({
          auditSessionId: auditId,
          userId,
          addedAssetIds: newAssetIds,
          skippedCount,
          tx,
        });
      }

      return { addedCount, skippedCount, newAssetIds, audit };
    })
    .then(async (result) => {
      // Create asset notes outside the transaction
      if (result.addedCount > 0) {
        await createAssetNotesForAuditAddition({
          assetIds: result.newAssetIds,
          userId,
          audit: result.audit,
        });
      }

      return {
        addedCount: result.addedCount,
        skippedCount: result.skippedCount,
      };
    });
}

/**
 * Removes a single asset from an audit session.
 * Only allowed for PENDING audits.
 * Deletes the AuditAsset entry and any associated AuditScan entries (cascade).
 * Updates audit counts and creates automatic activity note.
 */
export async function removeAssetFromAudit({
  auditId,
  auditAssetId,
  organizationId,
  userId,
}: {
  auditId: string;
  auditAssetId: string;
  organizationId: string;
  userId: string;
}): Promise<void> {
  return db
    .$transaction(async (tx) => {
      // Verify audit exists and is PENDING
      const audit = await tx.auditSession.findUnique({
        where: { id: auditId, organizationId },
        select: { id: true, name: true, status: true },
      });

      if (!audit) {
        throw new ShelfError({
          cause: null,
          message: "Audit not found",
          additionalData: { auditId, organizationId },
          label,
          status: 404,
        });
      }

      if (audit.status !== AuditStatus.PENDING) {
        throw new ShelfError({
          cause: null,
          message: "Can only remove assets from pending audits",
          additionalData: { auditId, status: audit.status },
          label,
          status: 400,
        });
      }

      // Fetch the audit asset to get the actual asset ID
      const auditAsset = await tx.auditAsset.findUnique({
        where: { id: auditAssetId },
        select: { assetId: true, expected: true },
      });

      if (!auditAsset) {
        throw new ShelfError({
          cause: null,
          message: "Audit asset not found",
          additionalData: { auditAssetId },
          label,
          status: 404,
        });
      }

      // Delete the audit asset (cascade will delete related scans)
      await tx.auditAsset.delete({
        where: { id: auditAssetId },
      });

      // Update audit session counts
      // If it was an expected asset, decrement expectedAssetCount
      if (auditAsset.expected) {
        await tx.auditSession.update({
          where: { id: auditId },
          data: {
            expectedAssetCount: { decrement: 1 },
            missingAssetCount: { decrement: 1 },
          },
        });
      }

      // Create activity note
      await createAssetRemovedFromAuditNote({
        auditSessionId: auditId,
        assetId: auditAsset.assetId,
        userId,
        tx,
      });

      return { assetId: auditAsset.assetId, audit };
    })
    .then(async (result) => {
      // Create asset note outside the transaction
      await createAssetNotesForAuditRemoval({
        assetIds: [result.assetId],
        userId,
        audit: result.audit,
      });
    });
}

/**
 * Removes multiple assets from an audit session (bulk operation).
 * Only allowed for PENDING audits.
 * Deletes the AuditAsset entries and any associated AuditScan entries (cascade).
 * Updates audit counts and creates automatic activity note.
 */
export async function removeAssetsFromAudit({
  auditId,
  auditAssetIds,
  organizationId,
  userId,
}: {
  auditId: string;
  auditAssetIds: string[];
  organizationId: string;
  userId: string;
}): Promise<{ removedCount: number }> {
  return db
    .$transaction(async (tx) => {
      // Verify audit exists and is PENDING
      const audit = await tx.auditSession.findUnique({
        where: { id: auditId, organizationId },
        select: { id: true, name: true, status: true },
      });

      if (!audit) {
        throw new ShelfError({
          cause: null,
          message: "Audit not found",
          additionalData: { auditId, organizationId },
          label,
          status: 404,
        });
      }

      if (audit.status !== AuditStatus.PENDING) {
        throw new ShelfError({
          cause: null,
          message: "Can only remove assets from pending audits",
          additionalData: { auditId, status: audit.status },
          label,
          status: 400,
        });
      }

      // Fetch the audit assets to get the actual asset IDs
      const auditAssets = await tx.auditAsset.findMany({
        where: { id: { in: auditAssetIds } },
        select: { id: true, assetId: true, expected: true },
      });

      if (auditAssets.length === 0) {
        return { removedCount: 0, assetIds: [], audit };
      }

      const assetIds = auditAssets.map((aa) => aa.assetId);
      const expectedCount = auditAssets.filter((aa) => aa.expected).length;

      // Delete the audit assets (cascade will delete related scans)
      await tx.auditAsset.deleteMany({
        where: { id: { in: auditAssetIds } },
      });

      // Update audit session counts
      if (expectedCount > 0) {
        await tx.auditSession.update({
          where: { id: auditId },
          data: {
            expectedAssetCount: { decrement: expectedCount },
            missingAssetCount: { decrement: expectedCount },
          },
        });
      }

      // Create activity note
      await createAssetsRemovedFromAuditNote({
        auditSessionId: auditId,
        assetIds,
        userId,
        tx,
      });

      return { removedCount: auditAssets.length, assetIds, audit };
    })
    .then(async (result) => {
      // Create asset notes outside the transaction
      if (result.removedCount > 0) {
        await createAssetNotesForAuditRemoval({
          assetIds: result.assetIds,
          userId,
          audit: result.audit,
        });
      }

      return { removedCount: result.removedCount };
    });
}

/**
 * Archives a completed or cancelled audit session.
 * Only audits in a terminal state (COMPLETED or CANCELLED) can be archived.
 * This is irreversible — there is no "unarchive" action.
 *
 * @param auditSessionId - The ID of the audit to archive
 * @param organizationId - The organization ID for scoping
 * @param userId - The user performing the archive action
 * @throws {ShelfError} If the audit is not found or not in a terminal status
 */
export async function archiveAuditSession({
  auditSessionId,
  organizationId,
  userId,
}: {
  auditSessionId: AuditSession["id"];
  organizationId: string;
  userId: string;
}): Promise<void> {
  try {
    // Wrap status update + activity note in a transaction so both
    // succeed or fail together (prevents orphaned state changes).
    // The updateMany WHERE clause atomically validates existence,
    // org scoping, and terminal status — no pre-read needed.
    await db.$transaction(async (tx) => {
      const result = await tx.auditSession.updateMany({
        where: {
          id: auditSessionId,
          organizationId,
          status: { in: [AuditStatus.COMPLETED, AuditStatus.CANCELLED] },
        },
        data: { status: AuditStatus.ARCHIVED },
      });

      if (result.count === 0) {
        throw new ShelfError({
          cause: null,
          message:
            "Audit could not be archived. It may not exist, is not in a terminal state, or was already modified.",
          additionalData: { auditSessionId, organizationId },
          label,
          status: 409,
        });
      }

      // Fetch user info for the activity note
      const user = await tx.user.findFirst({
        where: { id: userId },
        select: { firstName: true, lastName: true, displayName: true },
      });

      // Create activity note: "[User] archived the audit"
      await tx.auditNote.create({
        data: {
          content: `${wrapUserLinkForNote({
            id: userId,
            firstName: user?.firstName,
            lastName: user?.lastName,
          })} archived the audit`,
          type: "UPDATE",
          userId,
          auditSessionId,
        },
      });
    });
  } catch (cause) {
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Failed to archive audit session",
      additionalData: { auditSessionId, organizationId, userId },
      label,
      status: 500,
    });
  }
}

/**
 * Builds a Prisma WHERE clause for audits based on the current URL search
 * params. Used by bulk operations when the user selects "all" items across
 * pages so the operation respects any active filters.
 *
 * @param organizationId - The organization ID for scoping
 * @param currentSearchParams - Serialized URL search params from the index page
 * @param userId - The current user (used for assignment-scoped filters)
 * @param isSelfServiceOrBase - When true, restrict to audits assigned to userId
 *   (mirrors the loader's behavior in {@link getAuditsForOrganization})
 */
export function getAuditWhereInput({
  organizationId,
  currentSearchParams,
  userId,
  isSelfServiceOrBase,
}: {
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
  userId?: string;
  isSelfServiceOrBase?: boolean;
}): Prisma.AuditSessionWhereInput {
  const where: Prisma.AuditSessionWhereInput = { organizationId };

  // Filter by assignee for BASE/SELF_SERVICE users so select-all
  // never pulls in audits outside the user's visible scope
  if (isSelfServiceOrBase && userId) {
    where.assignments = {
      some: {
        userId,
      },
    };
  }

  // Always parse params — even when empty/null, we need to apply
  // default filters (e.g. exclude ARCHIVED) to mirror the index loader
  const searchParams = new URLSearchParams(currentSearchParams ?? "");

  // Normalize + validate the status param against the AuditStatus enum.
  // "ALL" and any unknown value fall through to the default branch so we
  // always exclude ARCHIVED unless a specific valid status is selected.
  const rawStatus = searchParams.get("status");
  const normalized = rawStatus ? rawStatus.toUpperCase() : null;
  const status =
    normalized &&
    normalized !== "ALL" &&
    (Object.values(AuditStatus) as string[]).includes(normalized)
      ? (normalized as AuditStatus)
      : null;

  if (status) {
    where.status = status;
  } else {
    // Mirror the index loader: exclude ARCHIVED by default when no
    // explicit status filter is set, so select-all never pulls in
    // audits the user didn't see in the list
    where.status = { notIn: [AuditStatus.ARCHIVED] };
  }

  // Respect the active search term so select-all only targets the
  // filtered subset the user sees, not every audit in the org
  const search = searchParams.get("s");
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  return where;
}

/**
 * Archives multiple audit sessions in a single transaction.
 * Only audits in a terminal state (COMPLETED or CANCELLED) will be archived.
 * Creates an activity note on each archived audit.
 *
 * Supports the "select all across pages" pattern via {@link ALL_SELECTED_KEY}.
 *
 * @param params.auditIds - Array of audit IDs (or containing ALL_SELECTED_KEY)
 * @param params.organizationId - Scoping organization
 * @param params.userId - The user performing the archive (for activity notes)
 * @param params.currentSearchParams - Serialized URL params for select-all filtering
 * @param params.isSelfServiceOrBase - When true, restrict select-all resolution
 *   to audits assigned to userId (matches the index loader's assignment scope)
 * @throws {ShelfError} If the selection is empty or any selected audit is not
 *   in a terminal state
 */
export async function bulkArchiveAudits({
  auditIds,
  organizationId,
  userId,
  currentSearchParams,
  isSelfServiceOrBase,
}: {
  auditIds: AuditSession["id"][];
  organizationId: Organization["id"];
  userId: string;
  currentSearchParams?: string | null;
  isSelfServiceOrBase?: boolean;
}) {
  try {
    /** When all items are selected, resolve from filters instead of IDs */
    const where: Prisma.AuditSessionWhereInput = auditIds.includes(
      ALL_SELECTED_KEY
    )
      ? getAuditWhereInput({
          currentSearchParams,
          organizationId,
          userId,
          isSelfServiceOrBase,
        })
      : { id: { in: auditIds }, organizationId };

    const audits = await db.auditSession.findMany({
      where,
      select: { id: true, status: true },
    });

    if (audits.length === 0) {
      throw new ShelfError({
        cause: null,
        message: "No archivable audits were found for your selection.",
        label,
        additionalData: { auditIds, organizationId },
        status: 400,
      });
    }

    const someNotTerminal = audits.some(
      (a) =>
        a.status !== AuditStatus.COMPLETED && a.status !== AuditStatus.CANCELLED
    );

    if (someNotTerminal) {
      throw new ShelfError({
        cause: null,
        message:
          "Some audits are not in a completed or cancelled state. Only completed or cancelled audits can be archived.",
        label,
        additionalData: { auditIds, organizationId },
      });
    }

    // Fetch user info once up-front for activity notes. Hoisted out of the
    // transaction to keep the write-only work inside $transaction small and
    // avoid holding a DB connection while reading unrelated data.
    const user = await db.user.findFirst({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });

    await db.$transaction(async (tx) => {
      // Keep terminal-state predicate on the write to guard against
      // concurrent status changes between the read and this update,
      // mirroring the single-item archiveAuditSession() pattern
      const result = await tx.auditSession.updateMany({
        where: {
          id: { in: audits.map((a) => a.id) },
          status: { in: [AuditStatus.COMPLETED, AuditStatus.CANCELLED] },
        },
        data: { status: AuditStatus.ARCHIVED },
      });

      if (result.count !== audits.length) {
        throw new ShelfError({
          cause: null,
          message:
            "Some audits could not be archived because their status changed. Please refresh and try again.",
          label,
          additionalData: {
            expected: audits.length,
            actual: result.count,
            organizationId,
          },
          status: 409,
        });
      }

      // Create an activity note on each archived audit
      await tx.auditNote.createMany({
        data: audits.map((a) => ({
          content: `${wrapUserLinkForNote({
            id: userId,
            firstName: user?.firstName,
            lastName: user?.lastName,
          })} archived the audit`,
          type: "UPDATE" as const,
          userId,
          auditSessionId: a.id,
        })),
      });
    });
  } catch (cause) {
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Failed to bulk archive audits",
      additionalData: { auditIds, organizationId, userId },
      label,
      status: 500,
    });
  }
}

/**
 * Removes an audit image's underlying files from Supabase storage.
 * Swallows per-file failures and logs them: a stale storage object is
 * a lesser evil than aborting the DB delete and leaving an orphaned
 * AuditSession row behind. Caller is responsible for deleting the DB
 * record afterwards (cascades from AuditSession handle that for us).
 *
 * @param image - The image record with public URLs to clean up
 */
async function safeRemoveAuditImageFiles(image: {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
}): Promise<void> {
  try {
    await removePublicFile({ publicUrl: image.imageUrl });
  } catch (cause) {
    // Intentionally omit the raw URL from additionalData — public
    // Supabase URLs contain storage object keys and a trailing token;
    // `imageId` is enough to trace the record if we need to.
    Logger.error(
      new ShelfError({
        cause: null,
        message: "Failed to remove audit image from storage during delete",
        additionalData: {
          imageId: image.id,
          storageError:
            cause instanceof Error ? cause.message : "Unknown storage error",
        },
        label,
      })
    );
  }

  if (image.thumbnailUrl) {
    try {
      await removePublicFile({ publicUrl: image.thumbnailUrl });
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause: null,
          message:
            "Failed to remove audit thumbnail from storage during delete",
          additionalData: {
            imageId: image.id,
            storageError:
              cause instanceof Error ? cause.message : "Unknown storage error",
          },
          label,
        })
      );
    }
  }
}

/**
 * Normalize audit-name confirmation strings for comparison.
 * Trims whitespace, applies Unicode NFC, and lower-cases. NFC matters
 * because macOS keyboards can emit decomposed characters (NFD) while
 * the DB stores the composed form, so `"Résumé" !== "Résumé"` without
 * normalization even when a user types the name exactly.
 */
const normalizeAuditName = (s: string): string =>
  s.trim().normalize("NFC").toLowerCase();

/**
 * Permanently deletes an archived audit session and all related data.
 *
 * Prerequisites:
 * - Audit must be in status `ARCHIVED` (enforced here and at the route).
 *   Delete is the intentional escape hatch past the archive-first contract,
 *   so `assertAuditNotArchived` is deliberately NOT called.
 * - Caller supplies the user's typed confirmation via `expectedName`. The
 *   compare is server-side and case-insensitive after NFC normalization,
 *   so a tampered client value can't bypass the name check.
 *
 * Cascade behavior (via Prisma `onDelete: Cascade`):
 * - AuditAsset, AuditScan, AuditNote, AuditImage, AuditAssignment all
 *   removed by the database when the parent AuditSession row is deleted.
 *
 * Storage cleanup:
 * - Image URLs are captured BEFORE the DB delete (the AuditImage rows
 *   cascade-delete with the session, so we'd lose them afterwards).
 * - Supabase storage removal runs AFTER the DB commit succeeds. A DB
 *   rollback or ARCHIVED-guard miss must never leave a zombie audit row
 *   pointing at already-deleted storage objects.
 * - Per-file failures on cleanup are logged and swallowed — see
 *   {@link safeRemoveAuditImageFiles}.
 *
 * @param auditSessionId - ID of the audit to delete
 * @param organizationId - Scoping organization (enforces tenant isolation)
 * @param userId - User performing the delete (for error context + log trail)
 * @param expectedName - Confirmation string the user typed in the dialog
 * @throws {ShelfError} 400 if confirmation doesn't match the stored name;
 *   404 if not found; 409 if not ARCHIVED; 500 on DB failure
 */
export async function deleteAuditSession({
  auditSessionId,
  organizationId,
  userId,
  expectedName,
}: {
  auditSessionId: AuditSession["id"];
  organizationId: Organization["id"];
  userId: string;
  expectedName: string;
}): Promise<void> {
  try {
    // Pre-read to validate existence, org scoping, name, and ARCHIVED
    // status — also the only chance to collect image URLs before cascade
    // wipes AuditImage rows.
    const audit = await db.auditSession.findFirst({
      where: { id: auditSessionId, organizationId },
      select: { id: true, status: true, name: true },
    });

    if (!audit) {
      throw new ShelfError({
        cause: null,
        message: "Audit not found.",
        additionalData: { auditSessionId, organizationId, userId },
        label,
        status: 404,
      });
    }

    if (normalizeAuditName(expectedName) !== normalizeAuditName(audit.name)) {
      throw new ShelfError({
        cause: null,
        message: "Confirmation did not match the audit name.",
        additionalData: { auditSessionId, organizationId },
        label,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    if (audit.status !== AuditStatus.ARCHIVED) {
      throw new ShelfError({
        cause: null,
        message: "Only archived audits can be deleted. Archive it first.",
        additionalData: {
          auditSessionId,
          organizationId,
          status: audit.status,
        },
        label,
        status: 409,
      });
    }

    // Capture image URLs for post-commit cleanup. Don't touch storage yet —
    // if the guarded deleteMany finds 0 rows due to a concurrent status
    // change, we must leave both the DB row AND its files intact.
    const images = await db.auditImage.findMany({
      where: { auditSessionId, organizationId },
      select: { id: true, imageUrl: true, thumbnailUrl: true },
    });

    // Final guard on the write: re-check ARCHIVED status atomically so a
    // concurrent status change between the pre-read and here can't sneak
    // a non-archived delete through.
    const result = await db.auditSession.deleteMany({
      where: {
        id: auditSessionId,
        organizationId,
        status: AuditStatus.ARCHIVED,
      },
    });

    if (result.count === 0) {
      throw new ShelfError({
        cause: null,
        message:
          "Audit could not be deleted. Its status may have changed, or it was removed by another process — please refresh and try again.",
        additionalData: { auditSessionId, organizationId },
        label,
        status: 409,
      });
    }

    // Permanent deletion leaves no AuditNote trail (cascade wipes them).
    // Emit a server-side info log so we retain a trace of who deleted what.
    Logger.info(
      `Permanently deleted audit ${auditSessionId} (org=${organizationId}, user=${userId})`
    );

    // DB commit succeeded — now best-effort storage cleanup. Failures are
    // logged; stale storage objects are recoverable, a zombie DB row
    // wouldn't be. Sequential is fine here: a single audit has at most a
    // handful of images.
    for (const image of images) {
      await safeRemoveAuditImageFiles(image);
    }
  } catch (cause) {
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Failed to delete audit session",
      additionalData: { auditSessionId, organizationId, userId },
      label,
      status: 500,
    });
  }
}

/**
 * Permanently deletes multiple archived audit sessions in a single operation.
 *
 * Supports the "select all across pages" pattern via {@link ALL_SELECTED_KEY}.
 * When all items are selected, resolution goes through
 * {@link getAuditWhereInput} AND is further narrowed to `status: ARCHIVED`
 * so non-archived audits in the filtered view can never be pulled in.
 *
 * Note: `isSelfServiceOrBase` is intentionally not a parameter here.
 * `PermissionAction.delete` on the audit entity is ADMIN/OWNER-only
 * (see `permission.data.ts`), so by the time we reach this function the
 * caller is already guaranteed not to be self-service/base. Wiring the
 * flag through would be dead plumbing that implies a policy choice
 * (delete-your-assigned-archives) no one has actually made.
 *
 * Ordering is all-or-nothing:
 * 1. Pre-read the target audits (ARCHIVED only).
 * 2. Capture image URLs for every target — needed BEFORE the cascade wipes
 *    the AuditImage rows.
 * 3. Run the guarded `deleteMany` inside a transaction. If the final count
 *    doesn't match the pre-read count (concurrent status change), the
 *    transaction throws and rolls back — no DB rows deleted.
 * 4. After commit, best-effort Supabase storage cleanup using the
 *    captured URLs. Per-file failures are logged and swallowed.
 *
 * Storage cleanup runs AFTER commit on purpose: a rolled-back transaction
 * must never leave zombie DB rows pointing at already-deleted files. We
 * don't wrap storage in the transaction because holding a DB connection
 * across N external Supabase HTTP calls invites pool starvation.
 *
 * @param auditIds - Array of audit IDs, or `[ALL_SELECTED_KEY]` for select-all
 * @param organizationId - Scoping organization
 * @param userId - User performing the bulk delete (for error context + log trail)
 * @param currentSearchParams - Serialized URL params, used when ALL_SELECTED_KEY
 * @returns Object with the count of audits actually deleted
 * @throws {ShelfError} If selection is empty, any audit is not ARCHIVED, or
 *   if a concurrent status change makes the bulk delete non-atomic
 */
export async function bulkDeleteAudits({
  auditIds,
  organizationId,
  userId,
  currentSearchParams,
}: {
  auditIds: AuditSession["id"][];
  organizationId: Organization["id"];
  userId: string;
  currentSearchParams?: string | null;
}): Promise<{ count: number }> {
  try {
    const selectAll = auditIds.includes(ALL_SELECTED_KEY);

    // Defense-in-depth for select-all: if the caller's active status
    // filter isn't ARCHIVED, refuse to force-narrow and delete only the
    // archived subset behind the user's back. The UI already gates this
    // (`audit-index-bulk-actions-dropdown.tsx`), but a direct POST to
    // this endpoint would otherwise bypass that check. Fail closed on an
    // irreversible operation.
    if (selectAll) {
      const paramStatus = new URLSearchParams(currentSearchParams ?? "")
        .get("status")
        ?.toUpperCase();
      if (paramStatus !== AuditStatus.ARCHIVED) {
        throw new ShelfError({
          cause: null,
          message:
            "Select-all delete requires the status filter to be set to Archived.",
          additionalData: { paramStatus, organizationId },
          label,
          status: 400,
        });
      }
    }

    // Rebuild the where clause from the current filters for select-all,
    // then narrow to ARCHIVED regardless — belt-and-suspenders for the
    // status guard above.
    const baseWhere: Prisma.AuditSessionWhereInput = selectAll
      ? getAuditWhereInput({
          currentSearchParams,
          organizationId,
        })
      : { id: { in: auditIds }, organizationId };

    const where: Prisma.AuditSessionWhereInput = {
      ...baseWhere,
      status: AuditStatus.ARCHIVED,
    };

    const audits = await db.auditSession.findMany({
      where,
      select: { id: true, status: true },
    });

    if (audits.length === 0) {
      throw new ShelfError({
        cause: null,
        message: "No deletable audits were found for your selection.",
        additionalData: { auditIds, organizationId },
        label,
        status: 400,
      });
    }

    // For explicit id-list (not select-all), make sure the user hadn't
    // selected any non-archived rows. Silent filtering would be confusing
    // ("I selected 10 but only 6 got deleted"). Better to block and tell
    // them.
    if (!selectAll) {
      const foundIds = new Set(audits.map((a) => a.id));
      const missing = auditIds.filter(
        (id) => id !== ALL_SELECTED_KEY && !foundIds.has(id)
      );
      if (missing.length > 0) {
        throw new ShelfError({
          cause: null,
          message:
            "Some selected audits are not archived. Only archived audits can be deleted.",
          additionalData: { missing, organizationId },
          label,
          status: 409,
        });
      }
    }

    const targetIds = audits.map((a) => a.id);

    // Capture every image URL BEFORE the delete so post-commit cleanup has
    // something to work with (the AuditImage rows cascade away with the
    // session). No storage side-effect yet — if the transaction rolls back
    // we must not have touched any file.
    const images = await db.auditImage.findMany({
      where: {
        auditSessionId: { in: targetIds },
        organizationId,
      },
      select: { id: true, imageUrl: true, thumbnailUrl: true },
    });

    // All-or-nothing: either every pre-read audit deletes, or the whole
    // thing rolls back. A mid-flight status change that shifts an audit
    // out of ARCHIVED must not produce a partial result.
    const { count } = await db.$transaction(async (tx) => {
      const deleted = await tx.auditSession.deleteMany({
        where: {
          id: { in: targetIds },
          organizationId,
          status: AuditStatus.ARCHIVED,
        },
      });

      if (deleted.count !== targetIds.length) {
        throw new ShelfError({
          cause: null,
          // The pre-read already confirmed every id was ARCHIVED + in-org,
          // so a mismatch here means a concurrent process either changed
          // an audit's status OR deleted an audit outright between the
          // pre-read and this write. Cover both causes in the message.
          message:
            "Some audits could not be deleted because their status changed or they were removed by another process. Please refresh and try again.",
          additionalData: {
            expected: targetIds.length,
            actual: deleted.count,
            organizationId,
          },
          label,
          status: 409,
        });
      }

      return deleted;
    });

    // Permanent deletion leaves no AuditNote trail for any of these rows
    // (cascade wipes them). Structured info log retains a trace.
    Logger.info(
      `Permanently deleted ${count} audits (org=${organizationId}, user=${userId}, ids=${targetIds.join(
        ","
      )})`
    );

    // Transaction committed — safe to remove storage objects now.
    // safeRemoveAuditImageFiles already logs + swallows per-file failures,
    // so parallelism is strictly a latency win. A select-all delete for a
    // large org could fan out thousands of concurrent Supabase requests
    // (throttling + event-loop pressure), so cap concurrency with a small
    // batch size.
    const STORAGE_CLEANUP_BATCH_SIZE = 10;
    for (let i = 0; i < images.length; i += STORAGE_CLEANUP_BATCH_SIZE) {
      await Promise.allSettled(
        images
          .slice(i, i + STORAGE_CLEANUP_BATCH_SIZE)
          .map((image) => safeRemoveAuditImageFiles(image))
      );
    }

    return { count };
  } catch (cause) {
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Failed to bulk delete audits",
      additionalData: { auditIds, organizationId, userId },
      label,
      status: 500,
    });
  }
}
