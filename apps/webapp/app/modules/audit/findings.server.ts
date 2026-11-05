/**
 * Audit findings service
 *
 * Reads the Findings shown on the audit overview: the condition notes and
 * photos people recorded while auditing. Findings about a specific asset are
 * paged, one page being a fixed number of ASSETS (each with all of its notes
 * and photos), so a page never splits one asset's evidence across requests.
 * Findings about the audit as a whole are few and are read in one go.
 *
 * Pages are keyset-paged on (asset title, AuditAsset id): each request starts
 * after the last row the list already holds. The set of assets with findings
 * changes while people audit (a deleted photo can take an asset out of it),
 * and a keyset keeps the next page correct either way, where an offset would
 * skip or repeat a row.
 *
 * @see {@link file://./../../routes/api+/audits.$auditId.findings.ts} Next pages
 * @see {@link file://./../../routes/_layout+/audits.$auditId.overview.tsx} First page
 * @see {@link file://./../../components/audit/audit-findings.tsx} The list
 */
import type { AuditSession, Organization, Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { ShelfError } from "~/utils/error";

/** Assets per page of findings. */
export const AUDIT_FINDINGS_PAGE_SIZE = 10;

/** The photo fields the Findings list renders. */
const FINDING_IMAGE_SELECT = {
  id: true,
  imageUrl: true,
  thumbnailUrl: true,
  description: true,
} as const satisfies Prisma.AuditImageSelect;

/**
 * The note fields the Findings list renders. COMMENT only: UPDATE rows are
 * the system trail, stored as Markdoc source, and belong to the Activity tab.
 */
const FINDING_NOTE_SELECT = {
  id: true,
  content: true,
  createdAt: true,
  user: { select: USER_NAME_SELECT },
} as const satisfies Prisma.AuditNoteSelect;

/** A photo taken during an audit, as the Findings list renders it. */
export type FindingImage = Prisma.AuditImageGetPayload<{
  select: typeof FINDING_IMAGE_SELECT;
}>;

/** A condition note written during an audit, as the Findings list renders it. */
export type FindingNote = Prisma.AuditNoteGetPayload<{
  select: typeof FINDING_NOTE_SELECT;
}>;

/** One asset somebody recorded something about, with all its notes and photos. */
export type AssetFinding = {
  assetId: string;
  assetName: string;
  images: FindingImage[];
  notes: FindingNote[];
};

/**
 * Where a page starts: the sort key of the last row of the previous page.
 * `id` is the AuditAsset id, which breaks ties between assets with the same
 * title.
 */
export type FindingsCursor = { title: string; id: string };

/** One page of asset findings. */
export type AuditFindingsPage = {
  findings: AssetFinding[];
  /** The cursor this page was read after; null for the first page. */
  after: FindingsCursor | null;
  /** Where the next page starts; null when this is the last page. */
  nextCursor: FindingsCursor | null;
  /** Assets with findings across the whole audit. */
  totalFindings: number;
  hasMore: boolean;
};

/** Notes and photos about the audit as a whole rather than one asset. */
export type AuditWideFindings = {
  notes: FindingNote[];
  images: FindingImage[];
};

/**
 * Reads one page of asset findings for an audit, alphabetical by asset name.
 *
 * Callers must already have authorized the caller for this audit; this
 * function only scopes the read to the organization.
 *
 * @param args.auditSessionId - The audit to read
 * @param args.organizationId - The caller's organization
 * @param args.after - Start after this row; omit for the first page
 * @returns The page, the cursor for the next one and the total number of
 *   assets with findings
 * @throws {ShelfError} If the database read fails
 */
export async function getAuditFindingsPage({
  auditSessionId,
  organizationId,
  after = null,
}: {
  auditSessionId: AuditSession["id"];
  organizationId: Organization["id"];
  after?: FindingsCursor | null;
}): Promise<AuditFindingsPage> {
  try {
    // A photo or note is linked to its audit asset by id alone, so the
    // nested reads also match the audit and workspace: evidence filed under
    // this audit's asset from anywhere else never shows or counts here.
    const imageWhere: Prisma.AuditImageWhereInput = {
      auditSessionId,
      organizationId,
    };
    const noteWhere: Prisma.AuditNoteWhereInput = {
      auditSessionId,
      type: "COMMENT",
    };
    const where: Prisma.AuditAssetWhereInput = {
      auditSessionId,
      auditSession: { organizationId },
      OR: [{ images: { some: imageWhere } }, { notes: { some: noteWhere } }],
    };

    // Rows strictly after the cursor in (title, id) order. A hand-written
    // condition rather than Prisma's `cursor`, which needs the cursor row to
    // still be in the set: it may have lost its last finding since.
    const afterCursor: Prisma.AuditAssetWhereInput | undefined = after
      ? {
          OR: [
            { asset: { title: { gt: after.title } } },
            { asset: { title: after.title }, id: { gt: after.id } },
          ],
        }
      : undefined;

    const [rows, totalFindings] = await Promise.all([
      db.auditAsset.findMany({
        where: afterCursor ? { AND: [where, afterCursor] } : where,
        // Must match `afterCursor`: title, then `id` to break ties.
        orderBy: [{ asset: { title: "asc" } }, { id: "asc" }],
        // One extra row says whether another page follows.
        take: AUDIT_FINDINGS_PAGE_SIZE + 1,
        select: {
          id: true,
          asset: { select: { id: true, title: true } },
          images: {
            where: imageWhere,
            select: FINDING_IMAGE_SELECT,
            orderBy: { createdAt: "asc" },
          },
          notes: {
            where: noteWhere,
            select: FINDING_NOTE_SELECT,
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      db.auditAsset.count({ where }),
    ]);

    const hasMore = rows.length > AUDIT_FINDINGS_PAGE_SIZE;
    const pageRows = rows.slice(0, AUDIT_FINDINGS_PAGE_SIZE);
    const last = pageRows.at(-1);

    return {
      findings: pageRows.map((row) => ({
        assetId: row.asset.id,
        assetName: row.asset.title,
        images: row.images,
        notes: row.notes,
      })),
      after,
      nextCursor:
        hasMore && last ? { title: last.asset.title, id: last.id } : null,
      totalFindings,
      hasMore,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to load the audit findings",
      additionalData: { auditSessionId, organizationId, after },
      label: "Audit",
    });
  }
}

/**
 * Reads the notes and photos recorded against the audit itself, such as the
 * completion note, oldest first.
 *
 * Callers must already have authorized the caller for this audit.
 *
 * @param args.auditSessionId - The audit to read
 * @param args.organizationId - The caller's organization
 * @returns The audit-wide notes and photos
 * @throws {ShelfError} If the database read fails
 */
export async function getAuditWideFindings({
  auditSessionId,
  organizationId,
}: {
  auditSessionId: AuditSession["id"];
  organizationId: Organization["id"];
}): Promise<AuditWideFindings> {
  try {
    const [notes, images] = await Promise.all([
      db.auditNote.findMany({
        where: {
          auditSessionId,
          auditSession: { organizationId },
          auditAssetId: null,
          type: "COMMENT",
        },
        select: FINDING_NOTE_SELECT,
        orderBy: { createdAt: "asc" },
      }),
      db.auditImage.findMany({
        where: { auditSessionId, organizationId, auditAssetId: null },
        select: FINDING_IMAGE_SELECT,
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return { notes, images };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to load the audit findings",
      additionalData: { auditSessionId, organizationId },
      label: "Audit",
    });
  }
}
