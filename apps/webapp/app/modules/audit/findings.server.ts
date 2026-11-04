/**
 * Audit findings service
 *
 * Reads the Findings shown on the audit overview: the condition notes and
 * photos people recorded while auditing. Findings about a specific asset are
 * paged, one page being a fixed number of ASSETS (each with all of its notes
 * and photos), so a page never splits one asset's evidence across requests.
 * Findings about the audit as a whole are few and are read in one go.
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

/** One page of asset findings. */
export type AuditFindingsPage = {
  findings: AssetFinding[];
  /** 1-based page number of `findings`. */
  page: number;
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
 * @param args.page - 1-based page number
 * @returns The page, the total number of assets with findings and whether
 *   another page follows
 * @throws {ShelfError} If the database read fails
 */
export async function getAuditFindingsPage({
  auditSessionId,
  organizationId,
  page,
}: {
  auditSessionId: AuditSession["id"];
  organizationId: Organization["id"];
  page: number;
}): Promise<AuditFindingsPage> {
  try {
    const where: Prisma.AuditAssetWhereInput = {
      auditSessionId,
      auditSession: { organizationId },
      OR: [{ images: { some: {} } }, { notes: { some: { type: "COMMENT" } } }],
    };

    const [rows, totalFindings] = await Promise.all([
      db.auditAsset.findMany({
        where,
        // `id` breaks ties between assets with the same name, so a row can
        // never appear on two pages or on none.
        orderBy: [{ asset: { title: "asc" } }, { id: "asc" }],
        skip: (page - 1) * AUDIT_FINDINGS_PAGE_SIZE,
        take: AUDIT_FINDINGS_PAGE_SIZE,
        select: {
          asset: { select: { id: true, title: true } },
          images: {
            select: FINDING_IMAGE_SELECT,
            orderBy: { createdAt: "asc" },
          },
          notes: {
            where: { type: "COMMENT" },
            select: FINDING_NOTE_SELECT,
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      db.auditAsset.count({ where }),
    ]);

    return {
      findings: rows.map((row) => ({
        assetId: row.asset.id,
        assetName: row.asset.title || "Unknown",
        images: row.images,
        notes: row.notes,
      })),
      page,
      totalFindings,
      hasMore: page * AUDIT_FINDINGS_PAGE_SIZE < totalFindings,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to load the audit findings",
      additionalData: { auditSessionId, organizationId, page },
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
