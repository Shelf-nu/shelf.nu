/**
 * Asset audit history.
 *
 * Serves the hover card on the "Last audit date" column: the audits that most
 * recently counted for an asset and the audits still ahead of it. The
 * "counted" rule matches the column's own value (completed or archived
 * sessions with a completion date), so the card and the cell never disagree.
 *
 * @see {@link file://./../../routes/api+/assets.$assetId.audit-history.ts}
 */
import type { AuditAssetStatus, AuditStatus } from "@prisma/client";
import { db } from "~/database/db.server";

/** How many audits each list holds unless the caller asks otherwise. */
const DEFAULT_LIMIT = 3;

/** One audit an asset took part in, as the hover card renders it. */
export type AssetAuditHistoryItem = {
  /** The audit session id. */
  id: string;
  /** The audit session name. */
  name: string;
  /** The audit session status. */
  status: AuditStatus;
  /** When the audit session was completed, if it has been. */
  completedAt: Date | null;
  /** When the audit session is due, if a due date was set. */
  dueDate: Date | null;
  /** The status of this asset inside the audit (not the audit's status). */
  assetStatus: AuditAssetStatus;
};

/** The columns both history queries read from the audit session. */
const auditSessionSelect = {
  id: true,
  name: true,
  status: true,
  completedAt: true,
  dueDate: true,
} as const;

/**
 * Loads an asset's most recent counted audits and its upcoming audits.
 *
 * Recent: completed or archived sessions with a completion date, newest first.
 * Upcoming: pending or active sessions, soonest due date first with undated
 * sessions last, then oldest created first.
 *
 * @param args.assetId - The asset; the caller verifies it belongs to the organization
 * @param args.organizationId - Scopes both queries to the workspace's audits
 * @param args.limit - Maximum items per list (default 3)
 * @returns The `recent` and `upcoming` lists
 */
export async function getAssetAuditHistory({
  assetId,
  organizationId,
  limit = DEFAULT_LIMIT,
}: {
  assetId: string;
  organizationId: string;
  limit?: number;
}): Promise<{
  recent: AssetAuditHistoryItem[];
  upcoming: AssetAuditHistoryItem[];
}> {
  const [recentRows, upcomingRows] = await Promise.all([
    db.auditAsset.findMany({
      where: {
        assetId,
        auditSession: {
          organizationId,
          status: { in: ["COMPLETED", "ARCHIVED"] },
          completedAt: { not: null },
        },
      },
      orderBy: [
        { auditSession: { completedAt: "desc" } },
        { auditSession: { createdAt: "desc" } },
      ],
      take: limit,
      select: { status: true, auditSession: { select: auditSessionSelect } },
    }),
    db.auditAsset.findMany({
      where: {
        assetId,
        auditSession: {
          organizationId,
          status: { in: ["PENDING", "ACTIVE"] },
        },
      },
      orderBy: [
        { auditSession: { dueDate: { sort: "asc", nulls: "last" } } },
        { auditSession: { createdAt: "asc" } },
      ],
      take: limit,
      select: { status: true, auditSession: { select: auditSessionSelect } },
    }),
  ]);

  return {
    recent: recentRows.map(toItem),
    upcoming: upcomingRows.map(toItem),
  };
}

/** Flattens an audit asset row into the card's item shape. */
function toItem(row: {
  status: AuditAssetStatus;
  auditSession: Omit<AssetAuditHistoryItem, "assetStatus">;
}): AssetAuditHistoryItem {
  return { ...row.auditSession, assetStatus: row.status };
}
