import { AuditAssetStatus } from "@shelf/database";
import { AuditStatus } from "@shelf/database";
import type { AuditAssignment, AuditSession } from "@shelf/database";
import type { UserOrganization } from "@shelf/database";
import { z } from "zod";

import type { SortingDirection } from "~/components/list/filters/sort-by";
import { db } from "~/database/db.server";
import {
  findMany,
  findFirst,
  findUnique,
  findUniqueOrThrow,
  create,
  update,
  count,
  createMany,
  updateMany,
  deleteMany,
  remove as removeRecord,
} from "~/database/query-helpers.server";
import { sql, raw, queryRaw } from "~/database/sql.server";
import {
  createAssetNotesForAuditAddition,
  createAssetNotesForAuditRemoval,
} from "~/modules/note/service.server";
import type { ClientHint } from "~/utils/client-hints";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { Logger } from "~/utils/logger";

import { QueueNames, scheduler } from "~/utils/scheduler.server";
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
const label: ErrorLabel = "Audit";

export const AUDIT_LIST_INCLUDE = {
  createdBy: {
    select: {
      firstName: true,
      lastName: true,
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
} satisfies Record<string, any>;

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

  const assets = await findMany(db, "Asset", {
    where: {
      id: { in: uniqueAssetIds },
      organizationId,
    },
    select: "id, title",
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

  const session = await create(db, "AuditSession", {
    name,
    description,
    organizationId,
    createdById,
    expectedAssetCount: assets.length,
    missingAssetCount: assets.length,
    scopeMeta: scopeMeta ?? undefined,
    dueDate,
  } as any);

  if (assets.length > 0) {
    await createMany(
      db,
      "AuditAsset",
      assets.map((asset) => ({
        auditSessionId: session.id,
        assetId: asset.id,
        expected: true,
      }))
    );
  }

  if (uniqueAssigneeIds.length > 0) {
    await createMany(
      db,
      "AuditAssignment",
      uniqueAssigneeIds.map((userId) => ({
        auditSessionId: session.id,
        userId,
      }))
    );
  }

  // Fetch session with assignments
  const sessionAssignments = await findMany(db, "AuditAssignment", {
    where: { auditSessionId: session.id },
  });

  const sessionWithAssignments = {
    ...session,
    assignments: sessionAssignments,
  };

  // Create automatic note for audit creation
  await createAuditCreationNote({
    auditSessionId: session.id,
    createdById,
    expectedAssetCount: assets.length,
    tx: db,
  });

  // Fetch the created audit assets to get their IDs
  const createdAuditAssets = await findMany(db, "AuditAsset", {
    where: {
      auditSessionId: session.id,
      expected: true,
    },
    select: "id, assetId",
  });

  // Create a map for quick lookup
  const auditAssetMap = new Map(
    createdAuditAssets.map((aa) => [aa.assetId, aa.id])
  );

  const result = {
    session: sessionWithAssignments,
    expectedAssets: assets.map((asset) => ({
      id: asset.id,
      name: asset.title,
      auditAssetId: auditAssetMap.get(asset.id) ?? "",
    })),
  } satisfies CreateAuditSessionResult;

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
  // Fetch the current audit to track changes
  // TODO: convert complex Prisma include — nested relations fetched separately
  const currentAuditBase = await findUnique(db, "AuditSession", {
    where: { id, organizationId },
    select: "id, name, description, status, dueDate",
  });

  const currentAuditAssignments = currentAuditBase
    ? await findMany(db, "AuditAssignment", {
        where: { auditSessionId: id },
        select: "userId",
      })
    : [];

  const currentAudit = currentAuditBase
    ? { ...currentAuditBase, assignments: currentAuditAssignments }
    : null;

  if (!currentAudit) {
    throw new ShelfError({
      cause: null,
      message: "Audit not found",
      additionalData: { id, organizationId },
      label: "Audit",
      status: 404,
    });
  }

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
    data.assigneeUserId === undefined ? undefined : data.assigneeUserId || null;

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
        new Date(currentAudit.dueDate).getTime() !== data.dueDate.getTime()));

  // Check if assignee changed
  const assigneeChanged =
    newAssignee !== undefined && newAssignee !== currentAssignee;

  // Single update for all audit session fields
  const updatedAudit = await update(db, "AuditSession", {
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
      await deleteMany(db, "AuditAssignment", {
        auditSessionId: id,
        userId: currentAssignee,
      });
    }
    // Add new assignee if provided
    if (newAssignee) {
      await create(db, "AuditAssignment", {
        auditSessionId: id,
        userId: newAssignee,
      } as any);
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
        tx: db,
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
        tx: db,
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
          tx: db,
        })
      );
    }
    if (newAssignee) {
      notePromises.push(
        createAssigneeAddedNote({
          auditSessionId: id,
          userId,
          assigneeUserId: newAssignee,
          tx: db,
        })
      );
    }
  }

  // Execute all note creations in parallel
  if (notePromises.length > 0) {
    await Promise.all(notePromises);
  }

  return updatedAudit;
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

    // Build where clause with OR for multi-org lookup
    const where: Record<string, any> = {
      OR: [
        { id, organizationId },
        ...(userOrganizations?.length
          ? [{ id, organizationId: { in: otherOrganizationIds } }]
          : []),
      ],
    };

    const session = (await findFirst(db, "AuditSession", {
      where,
    })) as any;

    if (!session) {
      throw new ShelfError({
        cause: null,
        message: "Audit session not found",
        additionalData: { id, organizationId },
        status: 404,
        label,
      });
    }

    // Fetch nested relations separately
    const [assignments, createdByUser, auditAssets] = await Promise.all([
      // Assignments with user details
      queryRaw<{
        id: string;
        auditSessionId: string;
        userId: string;
        role: string | null;
        createdAt: string;
        updatedAt: string;
        user_id: string;
        user_firstName: string | null;
        user_lastName: string | null;
        user_email: string;
        user_profilePicture: string | null;
      }>(
        db,
        sql`SELECT aa.*, u."id" AS "user_id", u."firstName" AS "user_firstName", u."lastName" AS "user_lastName", u."email" AS "user_email", u."profilePicture" AS "user_profilePicture" FROM "AuditAssignment" aa JOIN "User" u ON u."id" = aa."userId" WHERE aa."auditSessionId" = ${session.id}`
      ),
      // Created by user
      findUniqueOrThrow(db, "User", {
        where: { id: session.createdById },
        select: "id, firstName, lastName, email, profilePicture",
      }),
      // Audit assets with asset details and counts
      queryRaw<{
        id: string;
        auditSessionId: string;
        assetId: string;
        expected: boolean;
        status: string;
        scannedAt: string | null;
        scannedById: string | null;
        asset_id: string;
        asset_title: string;
        asset_mainImage: string | null;
        asset_thumbnailImage: string | null;
        notesCount: number;
        imagesCount: number;
      }>(
        db,
        sql`SELECT aas.*, a."id" AS "asset_id", a."title" AS "asset_title", a."mainImage" AS "asset_mainImage", a."thumbnailImage" AS "asset_thumbnailImage", (SELECT COUNT(*)::int FROM "AuditNote" an WHERE an."auditAssetId" = aas."id" AND an."type" = 'COMMENT') AS "notesCount", (SELECT COUNT(*)::int FROM "AuditImage" ai WHERE ai."auditAssetId" = aas."id") AS "imagesCount" FROM "AuditAsset" aas LEFT JOIN "Asset" a ON a."id" = aas."assetId" WHERE aas."auditSessionId" = ${session.id}`
      ),
    ]);

    // Reshape assignments to match expected structure
    session.assignments = assignments.map((a) => ({
      id: a.id,
      auditSessionId: a.auditSessionId,
      userId: a.userId,
      role: a.role,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
      user: {
        id: a.user_id,
        firstName: a.user_firstName,
        lastName: a.user_lastName,
        email: a.user_email,
        profilePicture: a.user_profilePicture,
      },
    }));

    session.createdBy = createdByUser;

    // Reshape audit assets
    session.assets = auditAssets.map((aa) => ({
      id: aa.id,
      auditSessionId: aa.auditSessionId,
      assetId: aa.assetId,
      expected: aa.expected,
      status: aa.status,
      scannedAt: aa.scannedAt,
      scannedById: aa.scannedById,
      asset: aa.asset_id
        ? {
            id: aa.asset_id,
            title: aa.asset_title,
            mainImage: aa.asset_mainImage,
            thumbnailImage: aa.asset_thumbnailImage,
          }
        : null,
      _count: {
        notes: aa.notesCount ?? 0,
        images: aa.imagesCount ?? 0,
      },
    }));

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
      .filter((auditAsset: any) => auditAsset.expected && auditAsset.asset)
      .map((auditAsset: any) => ({
        id: auditAsset.assetId,
        name: auditAsset.asset?.title ?? "",
        auditAssetId: auditAsset.id, // ID of the AuditAsset record (for notes/images)
        auditNotesCount: auditAsset._count?.notes ?? 0,
        auditImagesCount: auditAsset._count?.images ?? 0,
        mainImage: auditAsset.asset?.mainImage ?? null,
        thumbnailImage: auditAsset.asset?.thumbnailImage ?? null,
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
      await update(db, "AuditSession", {
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
    const auditSession = await findUnique(db, "AuditSession", {
      where: { id: auditId },
      select: "activeSchedulerReference",
    });

    if (!auditSession?.activeSchedulerReference) {
      Logger.info(
        `Skipping audit reminder cancellation for audit ${auditId} because no activeSchedulerReference was found.`
      );
      return;
    }

    await scheduler.cancel(auditSession.activeSchedulerReference);
    await update(db, "AuditSession", {
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
    const auditAssetWhere: Record<string, any> = {
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
    const auditAssets = await findMany(db, "AuditAsset", {
      where: auditAssetWhere,
      select: "id, assetId, expected, status",
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

    // Fetch assets with full details using Supabase embedded resource syntax
    // Build search condition for queryRaw if search is provided
    let searchCondition = sql``;
    if (search) {
      const searchTerm = `%${search.toLowerCase().trim()}%`;
      searchCondition = sql` AND (a."title" ILIKE ${searchTerm} OR EXISTS (SELECT 1 FROM "Category" c WHERE c."id" = a."categoryId" AND c."name" ILIKE ${searchTerm}) OR EXISTS (SELECT 1 FROM "Location" l WHERE l."id" = a."locationId" AND l."name" ILIKE ${searchTerm}))`;
    }

    const assetsRaw = await queryRaw<any>(
      db,
      sql`SELECT a."id", a."title", a."mainImage", a."thumbnailImage", a."mainImageExpiration", a."categoryId", a."locationId" FROM "Asset" a WHERE a."organizationId" = ${organizationId} AND a."id" = ANY(${assetIds}::text[]) ${searchCondition} ORDER BY a."title" ASC`
    );

    // Fetch related data for all returned assets
    const returnedAssetIds = assetsRaw.map((a: any) => a.id);
    const categoryIds = [
      ...new Set(assetsRaw.map((a: any) => a.categoryId).filter(Boolean)),
    ] as string[];
    const locationIds = [
      ...new Set(assetsRaw.map((a: any) => a.locationId).filter(Boolean)),
    ] as string[];

    const [categories, tags, locations, custodies] = await Promise.all([
      categoryIds.length > 0
        ? findMany(db, "Category", {
            where: { id: { in: categoryIds } },
            select: "id, name, color",
          })
        : [],
      // Tags via many-to-many join table
      returnedAssetIds.length > 0
        ? queryRaw<{
            assetId: string;
            id: string;
            name: string;
            color: string | null;
          }>(
            db,
            sql`SELECT at."A" AS "assetId", t."id", t."name", t."color" FROM "_AssetToTag" at JOIN "Tag" t ON t."id" = at."B" WHERE at."A" = ANY(${returnedAssetIds}::text[])`
          )
        : [],
      locationIds.length > 0
        ? queryRaw<{
            id: string;
            name: string;
            parentId: string | null;
            childrenCount: number;
          }>(
            db,
            sql`SELECT l."id", l."name", l."parentId", (SELECT COUNT(*)::int FROM "Location" lc WHERE lc."parentId" = l."id") AS "childrenCount" FROM "Location" l WHERE l."id" = ANY(${locationIds}::text[])`
          )
        : [],
      returnedAssetIds.length > 0
        ? queryRaw<{
            assetId: string;
            custodianId: string;
            custodianName: string;
            userId: string | null;
            userFirstName: string | null;
            userLastName: string | null;
            userEmail: string | null;
            userProfilePicture: string | null;
          }>(
            db,
            sql`SELECT cu."assetId", tm."id" AS "custodianId", tm."name" AS "custodianName", u."id" AS "userId", u."firstName" AS "userFirstName", u."lastName" AS "userLastName", u."email" AS "userEmail", u."profilePicture" AS "userProfilePicture" FROM "Custody" cu JOIN "TeamMember" tm ON tm."id" = cu."teamMemberId" LEFT JOIN "User" u ON u."id" = tm."userId" WHERE cu."assetId" = ANY(${returnedAssetIds}::text[])`
          )
        : [],
    ]);

    // Build lookup maps
    const categoryMap = new Map(categories.map((c) => [c.id, c]));
    const tagsByAsset = new Map<
      string,
      { id: string; name: string; color: string | null }[]
    >();
    for (const tag of tags) {
      const existing = tagsByAsset.get(tag.assetId) || [];
      existing.push({ id: tag.id, name: tag.name, color: tag.color });
      tagsByAsset.set(tag.assetId, existing);
    }
    const locationMap = new Map(
      locations.map((l) => [
        l.id,
        {
          id: l.id,
          name: l.name,
          parentId: l.parentId,
          _count: { children: l.childrenCount },
        },
      ])
    );
    const custodyByAsset = new Map(
      custodies.map((c) => [
        c.assetId,
        {
          custodian: {
            id: c.custodianId,
            name: c.custodianName,
            user: c.userId
              ? {
                  id: c.userId,
                  firstName: c.userFirstName,
                  lastName: c.userLastName,
                  email: c.userEmail,
                  profilePicture: c.userProfilePicture,
                }
              : null,
          },
        },
      ])
    );

    // Assemble the assets with all nested data
    const assets = assetsRaw.map((a: any) => ({
      id: a.id,
      title: a.title,
      mainImage: a.mainImage,
      thumbnailImage: a.thumbnailImage,
      mainImageExpiration: a.mainImageExpiration,
      category: a.categoryId ? categoryMap.get(a.categoryId) ?? null : null,
      tags: tagsByAsset.get(a.id) || [],
      location: a.locationId ? locationMap.get(a.locationId) ?? null : null,
      custody: custodyByAsset.get(a.id) || null,
    }));

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
    const session = await findFirst(db, "AuditSession", {
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
    const existingScan = await findFirst(db, "AuditScan", {
      where: {
        auditSessionId,
        assetId,
      },
      select: "id, auditAssetId",
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

    // Pre-fetch user and asset data for note creation
    const [scannerUser, scannedAsset] = await Promise.all([
      findUnique(db, "User", {
        where: { id: userId },
        select: "id, firstName, lastName",
      }),
      findUnique(db, "Asset", {
        where: { id: assetId },
        select: "id, title",
      }),
    ]);

    // Record the scan with sequential calls (replaces transaction)
    // If this is the first scan and audit is still PENDING, activate it
    if (session.status === AuditStatus.PENDING) {
      await update(db, "AuditSession", {
        where: { id: auditSessionId },
        data: {
          status: AuditStatus.ACTIVE,
          startedAt: new Date().toISOString(),
        },
      });

      // Create automatic note for audit being started
      await createAuditStartedNote({
        auditSessionId,
        userId,
        tx: db,
        prefetchedUser: scannerUser,
      });
    }

    // Create the scan record
    const scan = await create(db, "AuditScan", {
      auditSessionId,
      code: qrId,
      assetId,
      scannedById: userId,
      scannedAt: new Date().toISOString(),
    } as any);

    let auditAssetId: string | null = null;

    // Update or create the audit asset record
    if (isExpected) {
      // Expected asset - update its status to FOUND
      await updateMany(db, "AuditAsset", {
        where: {
          auditSessionId,
          assetId,
          expected: true,
        },
        data: {
          status: AuditAssetStatus.FOUND,
          scannedAt: new Date().toISOString(),
          scannedById: userId,
        },
      });

      // Get the audit asset ID for return
      const updatedAsset = await findFirst(db, "AuditAsset", {
        where: {
          auditSessionId,
          assetId,
          expected: true,
        },
        select: "id",
      });

      auditAssetId = updatedAsset?.id ?? null;
    } else {
      // Unexpected asset - create a new audit asset record
      const auditAsset = await create(db, "AuditAsset", {
        auditSessionId,
        assetId,
        expected: false,
        status: AuditAssetStatus.UNEXPECTED,
        scannedAt: new Date().toISOString(),
        scannedById: userId,
      } as any);
      auditAssetId = auditAsset.id;
    }

    // Link the scan to the audit asset so we can query it later
    if (auditAssetId) {
      await update(db, "AuditScan", {
        where: { id: scan.id },
        data: { auditAssetId },
      });
    }

    // Update the audit session counts using raw SQL for increment/decrement
    const updatedSessions = await queryRaw<{
      foundAssetCount: number;
      unexpectedAssetCount: number;
    }>(
      db,
      sql`UPDATE "AuditSession" SET "foundAssetCount" = ${
        isExpected
          ? sql`"foundAssetCount" + 1`
          : sql`${session.foundAssetCount}`
      }, "missingAssetCount" = ${
        isExpected
          ? sql`"missingAssetCount" - 1`
          : sql`${session.missingAssetCount}`
      }, "unexpectedAssetCount" = ${
        !isExpected
          ? sql`"unexpectedAssetCount" + 1`
          : sql`${session.unexpectedAssetCount}`
      }, "updatedAt" = NOW() WHERE "id" = ${auditSessionId} RETURNING "foundAssetCount", "unexpectedAssetCount"`
    );

    const updatedSession = updatedSessions[0] ?? {
      foundAssetCount: session.foundAssetCount,
      unexpectedAssetCount: session.unexpectedAssetCount,
    };

    // Create automatic note for asset scan using pre-fetched data
    await createAssetScanNote({
      auditSessionId,
      assetId,
      userId,
      isExpected,
      tx: db,
      prefetchedUser: scannerUser,
      prefetchedAsset: scannedAsset,
    });

    return {
      scanId: scan.id,
      auditAssetId,
      foundAssetCount: updatedSession.foundAssetCount,
      unexpectedAssetCount: updatedSession.unexpectedAssetCount,
    };
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
    const session = await findFirst(db, "AuditSession", {
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

    // Fetch scans with asset and auditAsset data via raw query
    const scans = await queryRaw<{
      id: string;
      auditSessionId: string;
      code: string | null;
      assetId: string | null;
      scannedAt: string;
      scannedById: string | null;
      auditAssetId: string | null;
      asset_id: string | null;
      asset_title: string | null;
      aa_id: string | null;
      aa_expected: boolean | null;
      aa_notesCount: number;
      aa_imagesCount: number;
    }>(
      db,
      sql`SELECT s.*, a."id" AS "asset_id", a."title" AS "asset_title", aa."id" AS "aa_id", aa."expected" AS "aa_expected", (SELECT COUNT(*)::int FROM "AuditNote" an WHERE an."auditAssetId" = aa."id" AND an."type" = 'COMMENT') AS "aa_notesCount", (SELECT COUNT(*)::int FROM "AuditImage" ai WHERE ai."auditAssetId" = aa."id") AS "aa_imagesCount" FROM "AuditScan" s LEFT JOIN "Asset" a ON a."id" = s."assetId" LEFT JOIN "AuditAsset" aa ON aa."id" = s."auditAssetId" WHERE s."auditSessionId" = ${auditSessionId} ORDER BY s."scannedAt" ASC`
    );

    // For scans without auditAsset relation (created before the fix that links them),
    // look up AuditAsset by assetId
    const assetIdsWithoutLink = scans
      .filter((s) => !s.aa_id && s.assetId)
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
      const auditAssets = await queryRaw<{
        id: string;
        assetId: string;
        expected: boolean;
        notesCount: number;
        imagesCount: number;
      }>(
        db,
        sql`SELECT aas."id", aas."assetId", aas."expected", (SELECT COUNT(*)::int FROM "AuditNote" an WHERE an."auditAssetId" = aas."id" AND an."type" = 'COMMENT') AS "notesCount", (SELECT COUNT(*)::int FROM "AuditImage" ai WHERE ai."auditAssetId" = aas."id") AS "imagesCount" FROM "AuditAsset" aas WHERE aas."auditSessionId" = ${auditSessionId} AND aas."assetId" = ANY(${assetIdsWithoutLink}::text[])`
      );

      for (const aa of auditAssets) {
        if (aa.assetId) {
          auditAssetsByAssetId.set(aa.assetId, {
            id: aa.id,
            expected: aa.expected,
            _count: { notes: aa.notesCount, images: aa.imagesCount },
          });
        }
      }
    }

    return scans.map((scan) => {
      // Use direct relation if available, otherwise fall back to lookup by assetId
      const auditAsset = scan.aa_id
        ? {
            id: scan.aa_id,
            expected: scan.aa_expected ?? false,
            _count: {
              notes: scan.aa_notesCount ?? 0,
              images: scan.aa_imagesCount ?? 0,
            },
          }
        : scan.assetId
        ? auditAssetsByAssetId.get(scan.assetId)
        : undefined;

      return {
        code: scan.code ?? "",
        assetId: scan.assetId ?? "",
        type: "asset" as const,
        scannedAt: new Date(scan.scannedAt),
        isExpected: auditAsset?.expected ?? false,
        assetTitle: scan.asset_title ?? "",
        auditAssetId: auditAsset?.id ?? null,
        auditNotesCount: auditAsset?._count?.notes ?? 0,
        auditImagesCount: auditAsset?._count?.images ?? 0,
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
    // Verify session exists and belongs to organization
    const session = await findUnique(db, "AuditSession", {
      where: { id: sessionId, organizationId },
      select: "id, status",
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
    await updateMany(db, "AuditAsset", {
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
        count(db, "AuditAsset", {
          auditSessionId: sessionId,
          expected: true,
        }),
        count(db, "AuditAsset", {
          auditSessionId: sessionId,
          status: "FOUND",
        }),
        count(db, "AuditAsset", {
          auditSessionId: sessionId,
          status: "MISSING",
        }),
        count(db, "AuditAsset", {
          auditSessionId: sessionId,
          expected: false,
        }),
      ]);

    // Update session to completed
    await update(db, "AuditSession", {
      where: { id: sessionId },
      data: {
        status: AuditStatus.COMPLETED,
        completedAt: new Date().toISOString(),
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
      tx: db,
    });

    // Fetch full audit details for email notification
    // TODO: convert complex Prisma include — nested relations fetched separately
    const completedAuditBase = await findUnique(db, "AuditSession", {
      where: { id: sessionId },
      select:
        "id, name, description, dueDate, completedAt, organizationId, createdById",
    });

    let completedAudit: any = null;
    if (completedAuditBase) {
      const [org, createdBy, assignmentsRaw, assetCount] = await Promise.all([
        queryRaw<{
          name: string;
          customEmailFooter: string | null;
          ownerEmail: string;
        }>(
          db,
          sql`SELECT o."name", o."customEmailFooter", u."email" AS "ownerEmail" FROM "Organization" o JOIN "User" u ON u."id" = o."userId" WHERE o."id" = ${completedAuditBase.organizationId}`
        ),
        findUniqueOrThrow(db, "User", {
          where: { id: completedAuditBase.createdById },
          select: "id, email, firstName, lastName",
        }),
        queryRaw<{
          userId: string;
          email: string;
          firstName: string | null;
          lastName: string | null;
        }>(
          db,
          sql`SELECT aa."userId", u."email", u."firstName", u."lastName" FROM "AuditAssignment" aa JOIN "User" u ON u."id" = aa."userId" WHERE aa."auditSessionId" = ${sessionId}`
        ),
        count(db, "AuditAsset", { auditSessionId: sessionId }),
      ]);

      const orgData = org[0];
      completedAudit = {
        ...completedAuditBase,
        organization: orgData
          ? {
              name: orgData.name,
              customEmailFooter: orgData.customEmailFooter,
              owner: { email: orgData.ownerEmail },
            }
          : null,
        _count: { assets: assetCount },
        createdBy,
        assignments: assignmentsRaw.map((a) => ({
          userId: a.userId,
          user: {
            email: a.email,
            firstName: a.firstName,
            lastName: a.lastName,
          },
        })),
      };
    }

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
    throw new ShelfError({
      cause,
      message: "Failed to complete audit session",
      additionalData: { sessionId, organizationId, userId },
      label,
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

    // Build SQL conditions
    const conditions = [sql`s."organizationId" = ${organizationId}`];

    // Filter by assignee for BASE/SELF_SERVICE users
    if (isSelfServiceOrBase && userId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM "AuditAssignment" aa WHERE aa."auditSessionId" = s."id" AND aa."userId" = ${userId})`
      );
    }

    // Add search filter
    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(
        sql`(s."name" ILIKE ${searchTerm} OR s."description" ILIKE ${searchTerm})`
      );
    }

    // Add status filter
    if (status) {
      conditions.push(sql`s."status" = ${status}`);
    }

    const whereSql = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

    // Sanitize orderBy to prevent SQL injection
    const allowedOrderColumns: Record<string, string> = {
      createdAt: '"createdAt"',
      name: '"name"',
      status: '"status"',
      updatedAt: '"updatedAt"',
      dueDate: '"dueDate"',
    };
    const orderCol = allowedOrderColumns[orderBy] || '"createdAt"';
    const orderDir = orderDirection === "asc" ? "ASC" : "DESC";
    const orderSql = sql`${raw(`${orderCol} ${orderDir}`)}`;

    const [auditsRaw, countResult] = await Promise.all([
      queryRaw<any>(
        db,
        sql`SELECT s.* FROM "AuditSession" s WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${take} OFFSET ${skip}`
      ),
      queryRaw<{ count: number }>(
        db,
        sql`SELECT COUNT(*)::int AS "count" FROM "AuditSession" s WHERE ${whereSql}`
      ),
    ]);

    const totalAudits = countResult[0]?.count ?? 0;

    // Fetch related data for all returned audits (matching AUDIT_LIST_INCLUDE)
    const auditIds = auditsRaw.map((a: any) => a.id);
    let audits: any[] = auditsRaw;

    if (auditIds.length > 0) {
      const [
        createdByUsers,
        assignmentsWithUsers,
        assetCounts,
        scanCounts,
        assignmentCounts,
      ] = await Promise.all([
        queryRaw<{
          auditId: string;
          firstName: string | null;
          lastName: string | null;
          email: string;
          profilePicture: string | null;
        }>(
          db,
          sql`SELECT s."id" AS "auditId", u."firstName", u."lastName", u."email", u."profilePicture" FROM "AuditSession" s JOIN "User" u ON u."id" = s."createdById" WHERE s."id" = ANY(${auditIds}::text[])`
        ),
        queryRaw<{
          auditSessionId: string;
          id: string;
          userId: string;
          role: string | null;
          userFirstName: string | null;
          userLastName: string | null;
          userEmail: string;
          userProfilePicture: string | null;
        }>(
          db,
          sql`SELECT aa."auditSessionId", aa."id", aa."userId", aa."role", u."firstName" AS "userFirstName", u."lastName" AS "userLastName", u."email" AS "userEmail", u."profilePicture" AS "userProfilePicture" FROM "AuditAssignment" aa JOIN "User" u ON u."id" = aa."userId" WHERE aa."auditSessionId" = ANY(${auditIds}::text[])`
        ),
        queryRaw<{ auditSessionId: string; count: number }>(
          db,
          sql`SELECT "auditSessionId", COUNT(*)::int AS "count" FROM "AuditAsset" WHERE "auditSessionId" = ANY(${auditIds}::text[]) GROUP BY "auditSessionId"`
        ),
        queryRaw<{ auditSessionId: string; count: number }>(
          db,
          sql`SELECT "auditSessionId", COUNT(*)::int AS "count" FROM "AuditScan" WHERE "auditSessionId" = ANY(${auditIds}::text[]) GROUP BY "auditSessionId"`
        ),
        queryRaw<{ auditSessionId: string; count: number }>(
          db,
          sql`SELECT "auditSessionId", COUNT(*)::int AS "count" FROM "AuditAssignment" WHERE "auditSessionId" = ANY(${auditIds}::text[]) GROUP BY "auditSessionId"`
        ),
      ]);

      // Build lookup maps
      const createdByMap = new Map(createdByUsers.map((u) => [u.auditId, u]));
      const assignmentsByAudit = new Map<string, any[]>();
      for (const a of assignmentsWithUsers) {
        const arr = assignmentsByAudit.get(a.auditSessionId) || [];
        arr.push({
          id: a.id,
          userId: a.userId,
          role: a.role,
          auditSessionId: a.auditSessionId,
          user: {
            firstName: a.userFirstName,
            lastName: a.userLastName,
            email: a.userEmail,
            profilePicture: a.userProfilePicture,
          },
        });
        assignmentsByAudit.set(a.auditSessionId, arr);
      }
      const assetCountMap = new Map(
        assetCounts.map((c) => [c.auditSessionId, c.count])
      );
      const scanCountMap = new Map(
        scanCounts.map((c) => [c.auditSessionId, c.count])
      );
      const assignmentCountMap = new Map(
        assignmentCounts.map((c) => [c.auditSessionId, c.count])
      );

      audits = auditsRaw.map((audit: any) => {
        const cb = createdByMap.get(audit.id);
        return {
          ...audit,
          createdBy: cb
            ? {
                firstName: cb.firstName,
                lastName: cb.lastName,
                email: cb.email,
                profilePicture: cb.profilePicture,
              }
            : null,
          assignments: assignmentsByAudit.get(audit.id) || [],
          _count: {
            assets: assetCountMap.get(audit.id) ?? 0,
            scans: scanCountMap.get(audit.id) ?? 0,
            assignments: assignmentCountMap.get(audit.id) ?? 0,
          },
        };
      });
    }

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
    // TODO: convert complex Prisma include — nested relations fetched separately
    const auditSessionBase = await findUnique(db, "AuditSession", {
      where: { id: auditSessionId, organizationId },
    });

    if (!auditSessionBase) {
      throw new ShelfError({
        cause: null,
        message: "Audit not found",
        additionalData: { auditSessionId, organizationId },
        label,
        status: 404,
      });
    }

    // Fetch related data in parallel
    const [createdBy, orgData, assignmentsRaw, assetCount] = await Promise.all([
      findUniqueOrThrow(db, "User", {
        where: { id: auditSessionBase.createdById },
        select: "email, firstName, lastName",
      }),
      queryRaw<{
        id: string;
        name: string;
        customEmailFooter: string | null;
        ownerEmail: string;
      }>(
        db,
        sql`SELECT o.*, u."email" AS "ownerEmail" FROM "Organization" o JOIN "User" u ON u."id" = o."userId" WHERE o."id" = ${auditSessionBase.organizationId}`
      ),
      queryRaw<{
        id: string;
        userId: string;
        auditSessionId: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
      }>(
        db,
        sql`SELECT aa."id", aa."userId", aa."auditSessionId", u."email", u."firstName", u."lastName" FROM "AuditAssignment" aa JOIN "User" u ON u."id" = aa."userId" WHERE aa."auditSessionId" = ${auditSessionId}`
      ),
      count(db, "AuditAsset", { auditSessionId }),
    ]);

    const org = orgData[0];
    const auditSession = {
      ...auditSessionBase,
      createdBy,
      organization: org
        ? {
            ...org,
            owner: { email: org.ownerEmail },
          }
        : null,
      assignments: assignmentsRaw.map((a) => ({
        id: a.id,
        userId: a.userId,
        auditSessionId: a.auditSessionId,
        user: {
          email: a.email,
          firstName: a.firstName,
          lastName: a.lastName,
        },
      })),
      _count: { assets: assetCount },
    } as any;

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
    const updatedAudit = await update(db, "AuditSession", {
      where: { id: auditSessionId },
      data: {
        status: AuditStatus.CANCELLED,
        cancelledAt: new Date().toISOString(),
      },
    });

    // Create activity note for cancellation
    await create(db, "AuditNote", {
      content: `${auditSession.createdBy.firstName} ${auditSession.createdBy.lastName} cancelled the audit`,
      type: "UPDATE",
      userId,
      auditSessionId,
    } as any);

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
  // Fetch pending audits with creator and assignment data
  const auditsRaw = await findMany(db, "AuditSession", {
    where: {
      organizationId,
      status: AuditStatus.PENDING,
    },
    select: "id, name, createdAt, expectedAssetCount, createdById",
    orderBy: { createdAt: "desc" },
  });

  if (auditsRaw.length === 0) return [];

  const auditIds = auditsRaw.map((a) => a.id);
  const creatorIds = [
    ...new Set(auditsRaw.map((a) => a.createdById)),
  ] as string[];

  const [creators, assignmentsRaw] = await Promise.all([
    creatorIds.length > 0
      ? findMany(db, "User", {
          where: { id: { in: creatorIds } },
          select: "id, firstName, lastName",
        })
      : [],
    queryRaw<{
      auditSessionId: string;
      firstName: string | null;
      lastName: string | null;
    }>(
      db,
      sql`SELECT aa."auditSessionId", u."firstName", u."lastName" FROM "AuditAssignment" aa JOIN "User" u ON u."id" = aa."userId" WHERE aa."auditSessionId" = ANY(${auditIds}::text[])`
    ),
  ]);

  const creatorMap = new Map(creators.map((c) => [c.id, c]));
  const assignmentsByAudit = new Map<string, any[]>();
  for (const a of assignmentsRaw) {
    const arr = assignmentsByAudit.get(a.auditSessionId) || [];
    arr.push({ user: { firstName: a.firstName, lastName: a.lastName } });
    assignmentsByAudit.set(a.auditSessionId, arr);
  }

  return auditsRaw.map((audit) => {
    const creator = creatorMap.get(audit.createdById);
    return {
      id: audit.id,
      name: audit.name,
      createdAt: audit.createdAt,
      expectedAssetCount: audit.expectedAssetCount,
      createdBy: creator
        ? { firstName: creator.firstName, lastName: creator.lastName }
        : null,
      assignments: assignmentsByAudit.get(audit.id) || [],
    };
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
  // Verify audit exists and is PENDING
  const audit = await findUnique(db, "AuditSession", {
    where: { id: auditId, organizationId },
    select: "id, name, status",
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
  const existingAuditAssets = await findMany(db, "AuditAsset", {
    where: {
      auditSessionId: auditId,
      assetId: { in: assetIds },
    },
    select: "assetId",
  });

  const existingAssetIds = new Set(existingAuditAssets.map((aa) => aa.assetId));

  // Filter out assets already in audit
  const newAssetIds = assetIds.filter((id) => !existingAssetIds.has(id));

  // Create new audit asset entries
  if (newAssetIds.length > 0) {
    await createMany(
      db,
      "AuditAsset",
      newAssetIds.map((assetId) => ({
        auditSessionId: auditId,
        assetId,
        expected: true,
        status: AuditAssetStatus.PENDING,
      }))
    );

    // Update audit session counts using raw SQL for increment
    await queryRaw(
      db,
      sql`UPDATE "AuditSession" SET "expectedAssetCount" = "expectedAssetCount" + ${newAssetIds.length}, "missingAssetCount" = "missingAssetCount" + ${newAssetIds.length}, "updatedAt" = NOW() WHERE "id" = ${auditId}`
    );
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
      tx: db,
    });
  }

  // Create asset notes
  if (addedCount > 0) {
    await createAssetNotesForAuditAddition({
      assetIds: newAssetIds,
      userId,
      audit,
    });
  }

  return { addedCount, skippedCount };
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
  // Verify audit exists and is PENDING
  const audit = await findUnique(db, "AuditSession", {
    where: { id: auditId, organizationId },
    select: "id, name, status",
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
  const auditAsset = await findUnique(db, "AuditAsset", {
    where: { id: auditAssetId },
    select: "assetId, expected",
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
  await removeRecord(db, "AuditAsset", { id: auditAssetId });

  // Update audit session counts
  // If it was an expected asset, decrement expectedAssetCount
  if (auditAsset.expected) {
    await queryRaw(
      db,
      sql`UPDATE "AuditSession" SET "expectedAssetCount" = "expectedAssetCount" - 1, "missingAssetCount" = "missingAssetCount" - 1, "updatedAt" = NOW() WHERE "id" = ${auditId}`
    );
  }

  // Create activity note
  await createAssetRemovedFromAuditNote({
    auditSessionId: auditId,
    assetId: auditAsset.assetId,
    userId,
    tx: db,
  });

  // Create asset note
  await createAssetNotesForAuditRemoval({
    assetIds: [auditAsset.assetId],
    userId,
    audit,
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
  // Verify audit exists and is PENDING
  const audit = await findUnique(db, "AuditSession", {
    where: { id: auditId, organizationId },
    select: "id, name, status",
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
  const auditAssets = await findMany(db, "AuditAsset", {
    where: { id: { in: auditAssetIds } },
    select: "id, assetId, expected",
  });

  if (auditAssets.length === 0) {
    return { removedCount: 0 };
  }

  const assetIds = auditAssets.map((aa) => aa.assetId);
  const expectedCount = auditAssets.filter((aa) => aa.expected).length;

  // Delete the audit assets (cascade will delete related scans)
  await deleteMany(db, "AuditAsset", { id: { in: auditAssetIds } });

  // Update audit session counts
  if (expectedCount > 0) {
    await queryRaw(
      db,
      sql`UPDATE "AuditSession" SET "expectedAssetCount" = "expectedAssetCount" - ${expectedCount}, "missingAssetCount" = "missingAssetCount" - ${expectedCount}, "updatedAt" = NOW() WHERE "id" = ${auditId}`
    );
  }

  // Create activity note
  await createAssetsRemovedFromAuditNote({
    auditSessionId: auditId,
    assetIds,
    userId,
    tx: db,
  });

  // Create asset notes
  if (auditAssets.length > 0) {
    await createAssetNotesForAuditRemoval({
      assetIds,
      userId,
      audit,
    });
  }

  return { removedCount: auditAssets.length };
}
