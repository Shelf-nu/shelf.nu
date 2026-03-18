import { AuditAssetStatus } from "@prisma/client";
import { AuditStatus } from "@prisma/client";
import type { AuditAssignment, AuditSession } from "@prisma/client";
import type { UserOrganization } from "@prisma/client";
import { z } from "zod";

import type { SortingDirection } from "~/components/list/filters/sort-by";
import { sbDb } from "~/database/supabase.server";
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

/** Supabase select string equivalent of the old Prisma AUDIT_LIST_INCLUDE */
export const AUDIT_LIST_SELECT =
  "*, createdBy:User!createdById(firstName, lastName, email, profilePicture), assignments:AuditAssignment(*, user:User!userId(firstName, lastName, email, profilePicture))";

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

  const { data: assets, error: assetsError } = await sbDb
    .from("Asset")
    .select("id, title")
    .eq("organizationId", organizationId)
    .in("id", uniqueAssetIds);

  if (assetsError) throw assetsError;

  if (!assets || assets.length !== uniqueAssetIds.length) {
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

  // Create the audit session
  const { data: session, error: sessionError } = await sbDb
    .from("AuditSession")
    .insert({
      name,
      description: description ?? null,
      organizationId,
      createdById,
      expectedAssetCount: assets.length,
      missingAssetCount: assets.length,
      scopeMeta: scopeMeta ?? null,
      dueDate: dueDate ? dueDate.toISOString() : null,
    })
    .select()
    .single();

  if (sessionError) throw sessionError;

  // Create audit asset entries
  if (assets.length > 0) {
    const { error: auditAssetError } = await sbDb.from("AuditAsset").insert(
      assets.map((asset) => ({
        auditSessionId: session.id,
        assetId: asset.id,
        expected: true,
      }))
    );

    if (auditAssetError) throw auditAssetError;
  }

  // Create audit assignment entries
  if (uniqueAssigneeIds.length > 0) {
    const { error: assignmentError } = await sbDb
      .from("AuditAssignment")
      .insert(
        uniqueAssigneeIds.map((userId) => ({
          auditSessionId: session.id,
          userId,
        }))
      );

    if (assignmentError) throw assignmentError;
  }

  // Fetch session with assignments
  const { data: sessionWithAssignments, error: fetchError } = await sbDb
    .from("AuditSession")
    .select("*, assignments:AuditAssignment(*)")
    .eq("id", session.id)
    .single();

  if (fetchError) throw fetchError;

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
  });

  // Fetch the created audit assets to get their IDs
  const { data: createdAuditAssets, error: createdAuditAssetsError } =
    await sbDb
      .from("AuditAsset")
      .select("id, assetId")
      .eq("auditSessionId", session.id)
      .eq("expected", true);

  if (createdAuditAssetsError) throw createdAuditAssetsError;

  // Create a map for quick lookup
  const auditAssetMap = new Map(
    (createdAuditAssets ?? []).map((aa) => [aa.assetId, aa.id])
  );

  const result = {
    session: sessionWithAssignments as any,
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
  const { data: currentAudit, error: fetchError } = await sbDb
    .from("AuditSession")
    .select(
      "name, description, status, dueDate, assignments:AuditAssignment(userId)"
    )
    .eq("id", id)
    .eq("organizationId", organizationId)
    .single();

  if (fetchError) throw fetchError;

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
  const currentAssignee =
    (currentAudit.assignments as unknown as { userId: string }[])[0]?.userId ||
    null;
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

  // Check if due date changed (Supabase returns dates as strings)
  const currentDueDate = currentAudit.dueDate
    ? new Date(currentAudit.dueDate)
    : null;
  const dueDateChanged =
    data.dueDate !== undefined &&
    ((currentDueDate === null && data.dueDate !== null) ||
      (currentDueDate !== null && data.dueDate === null) ||
      (currentDueDate !== null &&
        data.dueDate !== null &&
        currentDueDate.getTime() !== data.dueDate.getTime()));

  // Check if assignee changed
  const assigneeChanged =
    newAssignee !== undefined && newAssignee !== currentAssignee;

  // Single update for all audit session fields
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.dueDate !== undefined)
    updateData.dueDate = data.dueDate ? data.dueDate.toISOString() : null;

  const { data: updatedAudit, error: updateError } = await sbDb
    .from("AuditSession")
    .update(updateData)
    .eq("id", id)
    .eq("organizationId", organizationId)
    .select()
    .single();

  if (updateError) throw updateError;

  // Handle assignee changes
  if (assigneeChanged) {
    // Remove old assignee if exists
    if (currentAssignee) {
      const { error: deleteError } = await sbDb
        .from("AuditAssignment")
        .delete()
        .eq("auditSessionId", id)
        .eq("userId", currentAssignee);

      if (deleteError) throw deleteError;
    }
    // Add new assignee if provided
    if (newAssignee) {
      const { error: insertError } = await sbDb
        .from("AuditAssignment")
        .insert({ auditSessionId: id, userId: newAssignee });

      if (insertError) throw insertError;
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
      })
    );
  }

  // Due date change note
  if (dueDateChanged) {
    notePromises.push(
      createDueDateChangedNote({
        auditSessionId: id,
        userId,
        oldDate: currentDueDate,
        newDate: data.dueDate!,
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
        })
      );
    }
    if (newAssignee) {
      notePromises.push(
        createAssigneeAddedNote({
          auditSessionId: id,
          userId,
          assigneeUserId: newAssignee,
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

    // Build a list of all organization IDs to check
    const allOrgIds = [organizationId];
    if (otherOrganizationIds?.length) {
      allOrgIds.push(
        ...otherOrganizationIds.filter((oid) => oid !== organizationId)
      );
    }

    // Fetch the audit session with relations
    const { data: session, error: sessionError } = await sbDb
      .from("AuditSession")
      .select(
        "*, assignments:AuditAssignment(*, user:User!userId(id, firstName, lastName, email, profilePicture)), createdBy:User!createdById(id, firstName, lastName, email, profilePicture), assets:AuditAsset(id, assetId, expected, status, asset:Asset!assetId(id, title, mainImage, thumbnailImage))"
      )
      .eq("id", id)
      .in("organizationId", allOrgIds)
      .maybeSingle();

    if (sessionError) throw sessionError;

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

    // Fetch counts for notes (COMMENT type only) and images per audit asset
    const auditAssetIds = (session.assets as unknown as any[])
      .filter((aa: any) => aa.expected && aa.asset)
      .map((aa: any) => aa.id);

    // Batch fetch counts for all audit assets
    let notesCounts: Record<string, number> = {};
    let imagesCounts: Record<string, number> = {};

    if (auditAssetIds.length > 0) {
      const [notesResult, imagesResult] = await Promise.all([
        sbDb
          .from("AuditNote")
          .select("auditAssetId")
          .in("auditAssetId", auditAssetIds)
          .eq("type", "COMMENT"),
        sbDb
          .from("AuditImage")
          .select("auditAssetId")
          .in("auditAssetId", auditAssetIds),
      ]);

      // Count notes per audit asset
      if (notesResult.data) {
        for (const note of notesResult.data) {
          if (note.auditAssetId) {
            notesCounts[note.auditAssetId] =
              (notesCounts[note.auditAssetId] || 0) + 1;
          }
        }
      }

      // Count images per audit asset
      if (imagesResult.data) {
        for (const img of imagesResult.data) {
          if (img.auditAssetId) {
            imagesCounts[img.auditAssetId] =
              (imagesCounts[img.auditAssetId] || 0) + 1;
          }
        }
      }
    }

    const expectedAssets: AuditExpectedAsset[] = (
      session.assets as unknown as any[]
    )
      .filter((auditAsset: any) => auditAsset.expected && auditAsset.asset)
      .map((auditAsset: any) => ({
        id: auditAsset.assetId,
        name: auditAsset.asset?.title ?? "",
        auditAssetId: auditAsset.id, // ID of the AuditAsset record (for notes/images)
        auditNotesCount: notesCounts[auditAsset.id] ?? 0,
        auditImagesCount: imagesCounts[auditAsset.id] ?? 0,
        mainImage: auditAsset.asset?.mainImage ?? null,
        thumbnailImage: auditAsset.asset?.thumbnailImage ?? null,
      }));

    return {
      session: session as any,
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
      const { error } = await sbDb
        .from("AuditSession")
        .update({ activeSchedulerReference: id })
        .eq("id", data.id);

      if (error) throw error;
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
    const { data: auditSession, error: findError } = await sbDb
      .from("AuditSession")
      .select("activeSchedulerReference")
      .eq("id", auditId)
      .single();

    if (findError || !auditSession?.activeSchedulerReference) {
      Logger.info(
        `Skipping audit reminder cancellation for audit ${auditId} because no activeSchedulerReference was found.`
      );
      return;
    }

    await scheduler.cancel(auditSession.activeSchedulerReference);
    const { error: updateError } = await sbDb
      .from("AuditSession")
      .update({ activeSchedulerReference: null })
      .eq("id", auditId);

    if (updateError) throw updateError;
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
    // Build Supabase query for audit assets based on status filter
    let auditAssetQuery = sbDb
      .from("AuditAsset")
      .select("id, assetId, expected, status")
      .eq("auditSessionId", auditSessionId);

    // Apply status filter
    if (auditStatus && auditStatus !== "ALL") {
      switch (auditStatus) {
        case "EXPECTED":
          auditAssetQuery = auditAssetQuery.eq("expected", true);
          break;
        case "FOUND":
          auditAssetQuery = auditAssetQuery.eq(
            "status",
            AuditAssetStatus.FOUND
          );
          break;
        case "MISSING":
          auditAssetQuery = auditAssetQuery
            .eq("expected", true)
            .in("status", [AuditAssetStatus.MISSING, AuditAssetStatus.PENDING]);
          break;
        case "UNEXPECTED":
          auditAssetQuery = auditAssetQuery
            .eq("expected", false)
            .eq("status", AuditAssetStatus.UNEXPECTED);
          break;
      }
    }

    const { data: auditAssets, error: auditAssetsError } =
      await auditAssetQuery;

    if (auditAssetsError) throw auditAssetsError;

    const assetIds = (auditAssets ?? []).map((aa) => aa.assetId);

    // Create lookup map for audit status data
    const auditStatusMap = new Map(
      (auditAssets ?? []).map((aa) => [
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

    // Build Supabase query for assets with full details
    let assetQuery = sbDb
      .from("Asset")
      .select(
        "id, title, mainImage, thumbnailImage, mainImageExpiration, category:Category(id, name, color), tags:Tag(id, name, color), location:Location(id, name, parentId), custody:Custody(custodian:TeamMember!custodianId(id, name, user:User!userId(id, firstName, lastName, email, profilePicture)))"
      )
      .eq("organizationId", organizationId)
      .in("id", assetIds)
      .order("title", { ascending: true });

    // Apply search filter if provided
    if (search) {
      const searchTerm = search.toLowerCase().trim();
      assetQuery = assetQuery.or(`title.ilike.%${searchTerm}%`);
    }

    const { data: assets, error: assetsError } = await assetQuery;

    if (assetsError) throw assetsError;

    // Enrich assets with audit status data for "ALL" filter
    const enrichedAssets = (assets ?? []).map((asset) => ({
      ...asset,
      auditData: auditStatusMap.get(asset.id) || null,
    }));

    const totalItems = enrichedAssets.length;

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
    const { data: session, error: sessionError } = await sbDb
      .from("AuditSession")
      .select("*")
      .eq("id", auditSessionId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (sessionError) throw sessionError;

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
    const { data: existingScan, error: existingScanError } = await sbDb
      .from("AuditScan")
      .select("id, auditAssetId")
      .eq("auditSessionId", auditSessionId)
      .eq("assetId", assetId)
      .maybeSingle();

    if (existingScanError) throw existingScanError;

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
    const [scannerResult, scannedAssetResult] = await Promise.all([
      sbDb
        .from("User")
        .select("id, firstName, lastName")
        .eq("id", userId)
        .maybeSingle(),
      sbDb.from("Asset").select("id, title").eq("id", assetId).maybeSingle(),
    ]);

    const scannerUser = scannerResult.data;
    const scannedAsset = scannedAssetResult.data;

    // If this is the first scan and audit is still PENDING, activate it
    if (session.status === AuditStatus.PENDING) {
      const { error: activateError } = await sbDb
        .from("AuditSession")
        .update({
          status: AuditStatus.ACTIVE,
          startedAt: new Date().toISOString(),
        })
        .eq("id", auditSessionId);

      if (activateError) throw activateError;

      // Create automatic note for audit being started
      await createAuditStartedNote({
        auditSessionId,
        userId,
        prefetchedUser: scannerUser,
      });
    }

    // Create the scan record
    const { data: scan, error: scanError } = await sbDb
      .from("AuditScan")
      .insert({
        auditSessionId,
        code: qrId,
        assetId,
        scannedById: userId,
        scannedAt: new Date().toISOString(),
      })
      .select()
      .single();

    if (scanError) throw scanError;

    let auditAssetId: string | null = null;

    // Update or create the audit asset record
    if (isExpected) {
      // Expected asset - update its status to FOUND
      const { error: updateAssetError } = await sbDb
        .from("AuditAsset")
        .update({
          status: AuditAssetStatus.FOUND,
          scannedAt: new Date().toISOString(),
          scannedById: userId,
        })
        .eq("auditSessionId", auditSessionId)
        .eq("assetId", assetId)
        .eq("expected", true);

      if (updateAssetError) throw updateAssetError;

      // Get the audit asset ID for return
      const { data: updatedAsset } = await sbDb
        .from("AuditAsset")
        .select("id")
        .eq("auditSessionId", auditSessionId)
        .eq("assetId", assetId)
        .eq("expected", true)
        .maybeSingle();

      auditAssetId = updatedAsset?.id ?? null;
    } else {
      // Unexpected asset - create a new audit asset record
      const { data: auditAsset, error: createAssetError } = await sbDb
        .from("AuditAsset")
        .insert({
          auditSessionId,
          assetId,
          expected: false,
          status: AuditAssetStatus.UNEXPECTED,
          scannedAt: new Date().toISOString(),
          scannedById: userId,
        })
        .select()
        .single();

      if (createAssetError) throw createAssetError;
      auditAssetId = auditAsset.id;
    }

    // Link the scan to the audit asset so we can query it later
    if (auditAssetId) {
      const { error: linkError } = await sbDb
        .from("AuditScan")
        .update({ auditAssetId })
        .eq("id", scan.id);

      if (linkError) throw linkError;
    }

    // Update the audit session counts
    // Read-then-update since Supabase doesn't support increment/decrement
    const newFoundCount = isExpected
      ? session.foundAssetCount + 1
      : session.foundAssetCount;
    const newMissingCount = isExpected
      ? session.missingAssetCount - 1
      : session.missingAssetCount;
    const newUnexpectedCount = !isExpected
      ? session.unexpectedAssetCount + 1
      : session.unexpectedAssetCount;

    const { error: countUpdateError } = await sbDb
      .from("AuditSession")
      .update({
        foundAssetCount: newFoundCount,
        missingAssetCount: newMissingCount,
        unexpectedAssetCount: newUnexpectedCount,
      })
      .eq("id", auditSessionId);

    if (countUpdateError) throw countUpdateError;

    // Create automatic note for asset scan using pre-fetched data
    await createAssetScanNote({
      auditSessionId,
      assetId,
      userId,
      isExpected,
      prefetchedUser: scannerUser,
      prefetchedAsset: scannedAsset,
    });

    return {
      scanId: scan.id,
      auditAssetId,
      foundAssetCount: newFoundCount,
      unexpectedAssetCount: newUnexpectedCount,
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
    const { data: session, error: sessionError } = await sbDb
      .from("AuditSession")
      .select("id")
      .eq("id", auditSessionId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (sessionError) throw sessionError;

    if (!session) {
      throw new ShelfError({
        cause: null,
        message: "Audit session not found",
        additionalData: { auditSessionId, organizationId },
        status: 404,
        label,
      });
    }

    // Fetch scans with asset info
    const { data: scans, error: scansError } = await sbDb
      .from("AuditScan")
      .select(
        "*, asset:Asset!assetId(id, title), auditAsset:AuditAsset!auditAssetId(id, expected)"
      )
      .eq("auditSessionId", auditSessionId)
      .order("scannedAt", { ascending: true });

    if (scansError) throw scansError;

    // For scans without auditAsset relation (created before the fix that links them),
    // look up AuditAsset by assetId
    const assetIdsWithoutLink = (scans ?? [])
      .filter((s: any) => !s.auditAsset && s.assetId)
      .map((s: any) => s.assetId as string);

    const auditAssetsByAssetId = new Map<
      string,
      {
        id: string;
        expected: boolean;
      }
    >();

    if (assetIdsWithoutLink.length > 0) {
      const { data: auditAssets, error: auditAssetsError } = await sbDb
        .from("AuditAsset")
        .select("id, assetId, expected")
        .eq("auditSessionId", auditSessionId)
        .in("assetId", assetIdsWithoutLink);

      if (auditAssetsError) throw auditAssetsError;

      for (const aa of auditAssets ?? []) {
        if (aa.assetId) {
          auditAssetsByAssetId.set(aa.assetId, {
            id: aa.id,
            expected: aa.expected,
          });
        }
      }
    }

    // Collect all audit asset IDs (from both direct relation and lookup)
    const allAuditAssetIds = new Set<string>();
    for (const scan of scans ?? []) {
      const auditAsset =
        (scan as any).auditAsset ??
        ((scan as any).assetId
          ? auditAssetsByAssetId.get((scan as any).assetId)
          : undefined);
      if (auditAsset?.id) {
        allAuditAssetIds.add(auditAsset.id);
      }
    }

    // Batch fetch notes and images counts for all audit assets
    let notesCounts: Record<string, number> = {};
    let imagesCounts: Record<string, number> = {};

    if (allAuditAssetIds.size > 0) {
      const auditAssetIdArray = Array.from(allAuditAssetIds);
      const [notesResult, imagesResult] = await Promise.all([
        sbDb
          .from("AuditNote")
          .select("auditAssetId")
          .in("auditAssetId", auditAssetIdArray)
          .eq("type", "COMMENT"),
        sbDb
          .from("AuditImage")
          .select("auditAssetId")
          .in("auditAssetId", auditAssetIdArray),
      ]);

      if (notesResult.data) {
        for (const note of notesResult.data) {
          if (note.auditAssetId) {
            notesCounts[note.auditAssetId] =
              (notesCounts[note.auditAssetId] || 0) + 1;
          }
        }
      }

      if (imagesResult.data) {
        for (const img of imagesResult.data) {
          if (img.auditAssetId) {
            imagesCounts[img.auditAssetId] =
              (imagesCounts[img.auditAssetId] || 0) + 1;
          }
        }
      }
    }

    return (scans ?? []).map((scan: any) => {
      // Use direct relation if available, otherwise fall back to lookup by assetId
      const auditAsset =
        scan.auditAsset ??
        (scan.assetId ? auditAssetsByAssetId.get(scan.assetId) : undefined);

      return {
        code: scan.code ?? "",
        assetId: scan.assetId ?? "",
        type: "asset" as const,
        scannedAt: new Date(scan.scannedAt),
        isExpected: auditAsset?.expected ?? false,
        assetTitle: scan.asset?.title ?? "",
        auditAssetId: auditAsset?.id ?? null,
        auditNotesCount: auditAsset?.id ? notesCounts[auditAsset.id] ?? 0 : 0,
        auditImagesCount: auditAsset?.id ? imagesCounts[auditAsset.id] ?? 0 : 0,
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
    const { data: session, error: sessionError } = await sbDb
      .from("AuditSession")
      .select("id, status")
      .eq("id", sessionId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (sessionError) throw sessionError;

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
    const { error: updateMissingError } = await sbDb
      .from("AuditAsset")
      .update({ status: "MISSING" })
      .eq("auditSessionId", sessionId)
      .eq("expected", true)
      .eq("status", "PENDING");

    if (updateMissingError) throw updateMissingError;

    // Get all counts for completion note
    const [expectedResult, foundResult, missingResult, unexpectedResult] =
      await Promise.all([
        sbDb
          .from("AuditAsset")
          .select("*", { count: "exact", head: true })
          .eq("auditSessionId", sessionId)
          .eq("expected", true),
        sbDb
          .from("AuditAsset")
          .select("*", { count: "exact", head: true })
          .eq("auditSessionId", sessionId)
          .eq("status", "FOUND"),
        sbDb
          .from("AuditAsset")
          .select("*", { count: "exact", head: true })
          .eq("auditSessionId", sessionId)
          .eq("status", "MISSING"),
        sbDb
          .from("AuditAsset")
          .select("*", { count: "exact", head: true })
          .eq("auditSessionId", sessionId)
          .eq("expected", false),
      ]);

    if (expectedResult.error) throw expectedResult.error;
    if (foundResult.error) throw foundResult.error;
    if (missingResult.error) throw missingResult.error;
    if (unexpectedResult.error) throw unexpectedResult.error;

    const expectedCount = expectedResult.count ?? 0;
    const foundCount = foundResult.count ?? 0;
    const missingCount = missingResult.count ?? 0;
    const unexpectedCount = unexpectedResult.count ?? 0;

    // Update session to completed
    const { error: completeError } = await sbDb
      .from("AuditSession")
      .update({
        status: AuditStatus.COMPLETED,
        completedAt: new Date().toISOString(),
        missingAssetCount: missingCount,
      })
      .eq("id", sessionId);

    if (completeError) throw completeError;

    // Create automatic completion note with stats and optional user message
    await createAuditCompletedNote({
      auditSessionId: sessionId,
      userId,
      expectedCount,
      foundCount,
      missingCount,
      unexpectedCount,
      completionNote,
    });

    // Fetch full audit details for email notification
    const { data: completedAudit, error: completedError } = await sbDb
      .from("AuditSession")
      .select(
        "id, name, description, dueDate, completedAt, organizationId, organization:Organization!organizationId(name, customEmailFooter, owner:User!ownerId(email)), createdBy:User!createdById(id, email, firstName, lastName), assignments:AuditAssignment(userId, user:User!userId(email, firstName, lastName))"
      )
      .eq("id", sessionId)
      .single();

    if (completedError) throw completedError;

    // Get asset count separately
    const { count: assetCount } = await sbDb
      .from("AuditAsset")
      .select("*", { count: "exact", head: true })
      .eq("auditSessionId", sessionId);

    if (completedAudit && completedAudit.completedAt) {
      const completedAt = new Date(completedAudit.completedAt);
      const dueDate = completedAudit.dueDate
        ? new Date(completedAudit.dueDate)
        : null;

      // Calculate if audit was overdue
      const wasOverdue = dueDate && completedAt > dueDate;

      // Get assignees to notify (exclude the user who completed it)
      // Normalize assignments to email payload shape to allow creator injection.
      const assigneesToNotify = (completedAudit.assignments as unknown as any[])
        .filter((assignment: any) => assignment.user.email)
        .map((assignment: any) => ({
          userId: assignment.userId,
          user: assignment.user,
        }));

      // Always notify the audit creator even if they are not an assignee.
      const createdBy = completedAudit.createdBy as any;
      if (
        createdBy.email &&
        !assigneesToNotify.some(
          (assignment: any) => assignment.userId === createdBy.id
        )
      ) {
        assigneesToNotify.push({
          userId: createdBy.id,
          user: {
            email: createdBy.email,
            firstName: createdBy.firstName,
            lastName: createdBy.lastName,
          },
        });
      }

      // Send completion email
      sendAuditCompletedEmail({
        audit: {
          ...completedAudit,
          dueDate,
          completedAt,
          _count: { assets: assetCount ?? 0 },
        } as any,
        assigneesToNotify,
        hints,
        completedAt,
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

    // Build the main query
    let query = sbDb
      .from("AuditSession")
      .select(AUDIT_LIST_SELECT)
      .eq("organizationId", organizationId);

    // Build the count query
    let countQuery = sbDb
      .from("AuditSession")
      .select("*", { count: "exact", head: true })
      .eq("organizationId", organizationId);

    // Add search filter
    if (search) {
      const searchFilter = `name.ilike.%${search}%,description.ilike.%${search}%`;
      query = query.or(searchFilter);
      countQuery = countQuery.or(searchFilter);
    }

    // Add status filter
    if (status) {
      query = query.eq("status", status);
      countQuery = countQuery.eq("status", status);
    }

    // Apply ordering and pagination
    query = query
      .order(orderBy, { ascending: orderDirection === "asc" })
      .range(skip, skip + take - 1);

    // For BASE/SELF_SERVICE users, we need to filter by assignment
    // This requires a different approach since Supabase doesn't support
    // filtering by related table existence directly in the same query
    if (isSelfServiceOrBase && userId) {
      // First get audit session IDs that the user is assigned to
      const { data: assignedAudits, error: assignedError } = await sbDb
        .from("AuditAssignment")
        .select("auditSessionId")
        .eq("userId", userId);

      if (assignedError) throw assignedError;

      const assignedAuditIds = (assignedAudits ?? []).map(
        (a) => a.auditSessionId
      );

      if (assignedAuditIds.length === 0) {
        return { audits: [], totalAudits: 0 };
      }

      query = query.in("id", assignedAuditIds);
      countQuery = countQuery.in("id", assignedAuditIds);
    }

    const [auditsResult, countResult] = await Promise.all([query, countQuery]);

    if (auditsResult.error) throw auditsResult.error;
    if (countResult.error) throw countResult.error;

    // Fetch asset/scan/assignment counts separately for each audit
    const auditIds = (auditsResult.data ?? []).map((a: any) => a.id);
    let countsByAuditId: Record<
      string,
      { assets: number; scans: number; assignments: number }
    > = {};

    if (auditIds.length > 0) {
      const [assetsCountResult, scansCountResult] = await Promise.all([
        sbDb
          .from("AuditAsset")
          .select("auditSessionId")
          .in("auditSessionId", auditIds),
        sbDb
          .from("AuditScan")
          .select("auditSessionId")
          .in("auditSessionId", auditIds),
      ]);

      // Count per audit
      for (const id of auditIds) {
        countsByAuditId[id] = { assets: 0, scans: 0, assignments: 0 };
      }

      if (assetsCountResult.data) {
        for (const row of assetsCountResult.data) {
          if (countsByAuditId[row.auditSessionId]) {
            countsByAuditId[row.auditSessionId].assets++;
          }
        }
      }

      if (scansCountResult.data) {
        for (const row of scansCountResult.data) {
          if (countsByAuditId[row.auditSessionId]) {
            countsByAuditId[row.auditSessionId].scans++;
          }
        }
      }

      // Count assignments from the already-fetched data
      for (const audit of auditsResult.data ?? []) {
        if (countsByAuditId[(audit as any).id]) {
          countsByAuditId[(audit as any).id].assignments = (
            (audit as any).assignments ?? []
          ).length;
        }
      }
    }

    // Enrich audits with _count
    const audits = (auditsResult.data ?? []).map((audit: any) => ({
      ...audit,
      _count: countsByAuditId[audit.id] ?? {
        assets: 0,
        scans: 0,
        assignments: 0,
      },
    }));

    return { audits, totalAudits: countResult.count ?? 0 };
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
    const { data: auditSession, error: fetchError } = await sbDb
      .from("AuditSession")
      .select(
        "*, createdBy:User!createdById(email, firstName, lastName), organization:Organization!organizationId(id, name, customEmailFooter, owner:User!ownerId(email)), assignments:AuditAssignment(userId, user:User!userId(email, firstName, lastName))"
      )
      .eq("id", auditSessionId)
      .eq("organizationId", organizationId)
      .maybeSingle();

    if (fetchError) throw fetchError;

    if (!auditSession) {
      throw new ShelfError({
        cause: null,
        message: "Audit not found",
        additionalData: { auditSessionId, organizationId },
        label,
        status: 404,
      });
    }

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

    // Get asset count separately
    const { count: assetCount } = await sbDb
      .from("AuditAsset")
      .select("*", { count: "exact", head: true })
      .eq("auditSessionId", auditSessionId);

    // Update audit status to CANCELLED
    const { data: updatedAudit, error: updateError } = await sbDb
      .from("AuditSession")
      .update({
        status: AuditStatus.CANCELLED,
        cancelledAt: new Date().toISOString(),
      })
      .eq("id", auditSessionId)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create activity note for cancellation
    const createdBy = auditSession.createdBy as any;
    const { error: noteError } = await sbDb.from("AuditNote").insert({
      content: `${createdBy.firstName} ${createdBy.lastName} cancelled the audit`,
      type: "UPDATE",
      userId,
      auditSessionId,
    });

    if (noteError) throw noteError;

    // Send cancellation email to assignees (excluding creator)
    const assigneesToNotify = (
      auditSession.assignments as unknown as any[]
    ).filter(
      (assignment: any) => assignment.userId !== userId && assignment.user.email
    );

    // Use email helper to send cancellation emails with HTML template
    sendAuditCancelledEmails({
      audit: {
        ...auditSession,
        _count: { assets: assetCount ?? 0 },
      } as any,
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
  const { data, error } = await sbDb
    .from("AuditSession")
    .select(
      "id, name, createdAt, expectedAssetCount, createdBy:User!createdById(firstName, lastName), assignments:AuditAssignment(user:User!userId(firstName, lastName))"
    )
    .eq("organizationId", organizationId)
    .eq("status", AuditStatus.PENDING)
    .order("createdAt", { ascending: false });

  if (error) throw error;

  return data;
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
  const { data: audit, error: auditError } = await sbDb
    .from("AuditSession")
    .select("id, name, status")
    .eq("id", auditId)
    .eq("organizationId", organizationId)
    .maybeSingle();

  if (auditError) throw auditError;

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
  const { data: existingAuditAssets, error: existingError } = await sbDb
    .from("AuditAsset")
    .select("assetId")
    .eq("auditSessionId", auditId)
    .in("assetId", assetIds);

  if (existingError) throw existingError;

  const existingAssetIds = new Set(
    (existingAuditAssets ?? []).map((aa) => aa.assetId)
  );

  // Filter out assets already in audit
  const newAssetIds = assetIds.filter((id) => !existingAssetIds.has(id));

  // Create new audit asset entries
  if (newAssetIds.length > 0) {
    const { error: insertError } = await sbDb.from("AuditAsset").insert(
      newAssetIds.map((assetId) => ({
        auditSessionId: auditId,
        assetId,
        expected: true,
        status: AuditAssetStatus.PENDING,
      }))
    );

    if (insertError) throw insertError;

    // Update audit session counts (read-then-update)
    const { data: currentSession, error: readError } = await sbDb
      .from("AuditSession")
      .select("expectedAssetCount, missingAssetCount")
      .eq("id", auditId)
      .single();

    if (readError) throw readError;

    const { error: updateError } = await sbDb
      .from("AuditSession")
      .update({
        expectedAssetCount:
          currentSession.expectedAssetCount + newAssetIds.length,
        missingAssetCount:
          currentSession.missingAssetCount + newAssetIds.length,
      })
      .eq("id", auditId);

    if (updateError) throw updateError;
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
  const { data: audit, error: auditError } = await sbDb
    .from("AuditSession")
    .select("id, name, status")
    .eq("id", auditId)
    .eq("organizationId", organizationId)
    .maybeSingle();

  if (auditError) throw auditError;

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
  const { data: auditAsset, error: fetchAssetError } = await sbDb
    .from("AuditAsset")
    .select("assetId, expected")
    .eq("id", auditAssetId)
    .maybeSingle();

  if (fetchAssetError) throw fetchAssetError;

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
  const { error: deleteError } = await sbDb
    .from("AuditAsset")
    .delete()
    .eq("id", auditAssetId);

  if (deleteError) throw deleteError;

  // Update audit session counts
  // If it was an expected asset, decrement expectedAssetCount
  if (auditAsset.expected) {
    const { data: currentSession, error: readError } = await sbDb
      .from("AuditSession")
      .select("expectedAssetCount, missingAssetCount")
      .eq("id", auditId)
      .single();

    if (readError) throw readError;

    const { error: updateError } = await sbDb
      .from("AuditSession")
      .update({
        expectedAssetCount: currentSession.expectedAssetCount - 1,
        missingAssetCount: currentSession.missingAssetCount - 1,
      })
      .eq("id", auditId);

    if (updateError) throw updateError;
  }

  // Create activity note
  await createAssetRemovedFromAuditNote({
    auditSessionId: auditId,
    assetId: auditAsset.assetId,
    userId,
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
  const { data: audit, error: auditError } = await sbDb
    .from("AuditSession")
    .select("id, name, status")
    .eq("id", auditId)
    .eq("organizationId", organizationId)
    .maybeSingle();

  if (auditError) throw auditError;

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
  const { data: auditAssets, error: fetchError } = await sbDb
    .from("AuditAsset")
    .select("id, assetId, expected")
    .in("id", auditAssetIds);

  if (fetchError) throw fetchError;

  if (!auditAssets || auditAssets.length === 0) {
    return { removedCount: 0 };
  }

  const assetIds = auditAssets.map((aa) => aa.assetId);
  const expectedCount = auditAssets.filter((aa) => aa.expected).length;

  // Delete the audit assets (cascade will delete related scans)
  const { error: deleteError } = await sbDb
    .from("AuditAsset")
    .delete()
    .in("id", auditAssetIds);

  if (deleteError) throw deleteError;

  // Update audit session counts
  if (expectedCount > 0) {
    const { data: currentSession, error: readError } = await sbDb
      .from("AuditSession")
      .select("expectedAssetCount, missingAssetCount")
      .eq("id", auditId)
      .single();

    if (readError) throw readError;

    const { error: updateError } = await sbDb
      .from("AuditSession")
      .update({
        expectedAssetCount: currentSession.expectedAssetCount - expectedCount,
        missingAssetCount: currentSession.missingAssetCount - expectedCount,
      })
      .eq("id", auditId);

    if (updateError) throw updateError;
  }

  // Create activity note
  await createAssetsRemovedFromAuditNote({
    auditSessionId: auditId,
    assetIds,
    userId,
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
