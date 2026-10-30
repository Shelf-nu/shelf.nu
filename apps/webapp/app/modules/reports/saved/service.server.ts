/**
 * Saved reports (Advanced Reports add-on).
 *
 * A saved report belongs to the workspace, not to the person who saved it:
 * everyone who can open `/reports` (Owners and Admins) sees the same list and
 * may rename or delete any entry. The record stores the builder page's query
 * string; see `query.ts` for what that string may contain.
 *
 * @see {@link file://./query.ts}
 * @see {@link file://../../../routes/_layout+/reports.builder.tsx}
 */

import { db } from "~/database/db.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { MAX_SAVED_REPORTS } from "./constants";
import { sanitizeSavedReportQuery } from "./query";

const label: ErrorLabel = "Report";

/** Fields every caller of this module receives. */
const SAVED_REPORT_SELECT = {
  id: true,
  name: true,
  query: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
  // The name fields, never a pre-formatted name: callers resolve it with
  // `resolveUserDisplayName` so the display name wins over the legal name.
  createdBy: { select: USER_NAME_SELECT },
} as const;

/** A saved report as returned by this module. */
export type SavedReportRecord = {
  id: string;
  name: string;
  query: string;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  createdBy: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  };
};

/**
 * Trims a name and refuses an empty one.
 *
 * @throws {ShelfError} 400 when the trimmed name is empty
 */
function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new ShelfError({
      cause: null,
      label,
      message: "Name is required.",
      status: 400,
      shouldBeCaptured: false,
    });
  }
  return trimmed;
}

/**
 * Name predicate for the duplicate check. Two names that differ only in case
 * are the same report to a reader, so the check ignores case; the unique index
 * on the table stays case-sensitive as the last line of defence.
 */
function nameEquals(name: string) {
  return { equals: name, mode: "insensitive" as const };
}

/** The 409 thrown when a workspace already has a report with the name. */
function duplicateNameError(name: string) {
  return new ShelfError({
    cause: null,
    label,
    message: `This workspace already has a saved report named "${name}". Please use a different name.`,
    status: 409,
    shouldBeCaptured: false,
  });
}

/** The 404 thrown when an id does not belong to the workspace. */
function notFoundError(id: string, organizationId: string) {
  return new ShelfError({
    cause: null,
    label,
    message: "We couldn't find that saved report.",
    additionalData: { id, organizationId },
    status: 404,
    shouldBeCaptured: false,
  });
}

/**
 * Lists a workspace's saved reports, alphabetically.
 *
 * @param args.organizationId - The workspace
 * @returns The saved reports, name ascending
 */
export function listSavedReports({
  organizationId,
}: {
  organizationId: string;
}): Promise<SavedReportRecord[]> {
  return db.savedReport.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
    select: SAVED_REPORT_SELECT,
  });
}

/**
 * Saves a report for the workspace.
 *
 * Runs in one transaction so the cap and the duplicate-name check cannot race
 * with a second save. The stored query is sanitised, never the raw input.
 *
 * @param args.organizationId - The workspace the report belongs to
 * @param args.createdById - The user saving it (kept for the audit trail)
 * @param args.name - Display name, unique per workspace after trimming
 * @param args.query - The builder page's query string
 * @returns The created record
 * @throws {ShelfError} 400 empty name or cap reached; 409 duplicate name
 */
export async function createSavedReport({
  organizationId,
  createdById,
  name,
  query,
}: {
  organizationId: string;
  createdById: string;
  name: string;
  query: string;
}): Promise<SavedReportRecord> {
  const trimmedName = normalizeName(name);
  const sanitizedQuery = sanitizeSavedReportQuery(query);

  return db.$transaction(async (tx) => {
    const existingCount = await tx.savedReport.count({
      where: { organizationId },
    });
    if (existingCount >= MAX_SAVED_REPORTS) {
      throw new ShelfError({
        cause: null,
        label,
        message: `A workspace can keep up to ${MAX_SAVED_REPORTS} saved reports. Please delete one before saving another.`,
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const duplicate = await tx.savedReport.findFirst({
      where: { organizationId, name: nameEquals(trimmedName) },
      select: { id: true },
    });
    if (duplicate) throw duplicateNameError(trimmedName);

    return tx.savedReport.create({
      data: {
        organizationId,
        createdById,
        name: trimmedName,
        query: sanitizedQuery,
      },
      select: SAVED_REPORT_SELECT,
    });
  });
}

/**
 * Renames a saved report of the workspace.
 *
 * @param args.id - The saved report
 * @param args.organizationId - The workspace it must belong to
 * @param args.name - The new name
 * @returns The updated record (unchanged when the name is the same)
 * @throws {ShelfError} 404 not in this workspace; 400 empty; 409 duplicate
 */
export async function renameSavedReport({
  id,
  organizationId,
  name,
}: {
  id: string;
  organizationId: string;
  name: string;
}): Promise<SavedReportRecord> {
  const trimmedName = normalizeName(name);

  return db.$transaction(async (tx) => {
    const report = await tx.savedReport.findFirst({
      where: { id, organizationId },
      select: SAVED_REPORT_SELECT,
    });
    if (!report) throw notFoundError(id, organizationId);
    if (report.name === trimmedName) return report;

    const duplicate = await tx.savedReport.findFirst({
      where: { organizationId, name: nameEquals(trimmedName), NOT: { id } },
      select: { id: true },
    });
    if (duplicate) throw duplicateNameError(trimmedName);

    return tx.savedReport.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: the findFirst above proves id + organizationId in this same tx
      where: { id },
      data: { name: trimmedName },
      select: SAVED_REPORT_SELECT,
    });
  });
}

/**
 * Deletes a saved report of the workspace.
 *
 * @param args.id - The saved report
 * @param args.organizationId - The workspace it must belong to
 * @throws {ShelfError} 404 when the id is not in this workspace
 */
export async function deleteSavedReport({
  id,
  organizationId,
}: {
  id: string;
  organizationId: string;
}): Promise<void> {
  // deleteMany carries the org predicate itself, so a foreign id deletes
  // nothing instead of needing a separate ownership read.
  const { count } = await db.savedReport.deleteMany({
    where: { id, organizationId },
  });
  if (count === 0) throw notFoundError(id, organizationId);
}
