/**
 * Activity Event Reports
 *
 * Read-side query helpers over `ActivityEvent`. These are pure functions — no
 * routes, no UI, no auth. Consumers are the future reporting UI (routes,
 * loaders) which wrap each call with its own org-scope permission check.
 *
 * Every query is organization-scoped and uses indexed columns
 * (`organizationId` + `action`/`entityId`/`occurredAt`) — no JSON field
 * scans, no content parsing.
 *
 * @see {@link file://./service.server.ts}
 */

import type { ActivityAction } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import type { ActorSnapshot } from "./types";

/** Asset-scoped actions used by `assetChangeHistory`. Additive as new ones land. */
const ASSET_ACTIONS = [
  "ASSET_CREATED",
  "ASSET_NAME_CHANGED",
  "ASSET_DESCRIPTION_CHANGED",
  "ASSET_CATEGORY_CHANGED",
  "ASSET_KIT_CHANGED",
  "ASSET_LOCATION_CHANGED",
  "ASSET_TAGS_CHANGED",
  "ASSET_STATUS_CHANGED",
  "ASSET_VALUATION_CHANGED",
  "ASSET_CUSTOM_FIELD_CHANGED",
  "ASSET_ARCHIVED",
  "ASSET_DELETED",
] as const satisfies readonly ActivityAction[];

/** Common window + org scope parameters. */
type ReportScope = {
  organizationId: string;
  from: Date;
  to: Date;
};

/** Generic event row exposed to report consumers. */
export type ReportEvent = {
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  actorSnapshot: ActorSnapshot | null;
  field: string | null;
  fromValue: Prisma.JsonValue;
  toValue: Prisma.JsonValue;
  meta: Prisma.JsonValue;
};

/**
 * Full change history for a single asset within a timeframe. Ordered most-recent-first.
 */
export async function assetChangeHistory({
  organizationId,
  assetId,
  from,
  to,
}: ReportScope & { assetId: string }): Promise<ReportEvent[]> {
  try {
    const rows = await db.activityEvent.findMany({
      where: {
        organizationId,
        assetId,
        occurredAt: { gte: from, lte: to },
        action: { in: [...ASSET_ACTIONS] },
      },
      orderBy: { occurredAt: "desc" },
      select: reportEventSelect,
    });
    return rows.map(toReportEvent);
  } catch (cause) {
    throw wrap(cause, "assetChangeHistory", { organizationId, assetId });
  }
}

/**
 * Count of `BOOKING_STATUS_CHANGED` events per destination status within a timeframe.
 *
 * `toValue` holds the new status as a JSON string (e.g. `"ONGOING"`), so a
 * raw groupBy is used — Prisma's typed `groupBy` does not accept a Json column.
 */
export async function bookingStatusTransitionCounts({
  organizationId,
  from,
  to,
}: ReportScope): Promise<Array<{ toStatus: string; count: number }>> {
  try {
    // `#>> '{}'` extracts the JSON scalar as text — works for any top-level
    // JSON primitive. Indexed on (organizationId, action, occurredAt).
    const rows = await db.$queryRaw<
      Array<{ to_status: string; count: bigint }>
    >`
      SELECT "toValue" #>> '{}' AS to_status, COUNT(*) AS count
      FROM "ActivityEvent"
      WHERE "organizationId" = ${organizationId}
        AND action = 'BOOKING_STATUS_CHANGED'
        AND "occurredAt" >= ${from}
        AND "occurredAt" <= ${to}
      GROUP BY to_status
      ORDER BY count DESC
    `;
    return rows.map((r) => ({ toStatus: r.to_status, count: Number(r.count) }));
  } catch (cause) {
    throw wrap(cause, "bookingStatusTransitionCounts", { organizationId });
  }
}

/** Audit completion event with its counters (expected/found/missing/unexpected) in `meta`. */
export type AuditCompletionRow = {
  auditSessionId: string;
  actorUserId: string | null;
  occurredAt: Date;
  meta: Prisma.JsonValue;
};

/**
 * All `AUDIT_COMPLETED` events within a timeframe. `meta` holds the counters
 * written by the audit service — consumer formats them for display.
 */
export async function auditCompletionStats({
  organizationId,
  from,
  to,
}: ReportScope): Promise<AuditCompletionRow[]> {
  try {
    const rows = await db.activityEvent.findMany({
      where: {
        organizationId,
        action: "AUDIT_COMPLETED",
        occurredAt: { gte: from, lte: to },
      },
      select: {
        auditSessionId: true,
        actorUserId: true,
        occurredAt: true,
        meta: true,
      },
      orderBy: { occurredAt: "desc" },
    });
    return rows
      .filter((r): r is typeof r & { auditSessionId: string } =>
        Boolean(r.auditSessionId)
      )
      .map((r) => ({
        auditSessionId: r.auditSessionId,
        actorUserId: r.actorUserId,
        occurredAt: r.occurredAt,
        meta: r.meta as Prisma.JsonValue,
      }));
  } catch (cause) {
    throw wrap(cause, "auditCompletionStats", { organizationId });
  }
}

/** One custody window — assigned at `heldFrom`, released at `heldTo` (null if still held). */
export type CustodyWindow = {
  assetId: string;
  actorUserId: string | null;
  heldFrom: Date;
  heldTo: Date | null;
  durationSeconds: number | null;
};

/**
 * Pair `CUSTODY_ASSIGNED` with the next `CUSTODY_RELEASED` per asset using a
 * window function, so consumers can compute "who held what for how long."
 *
 * Raw SQL because Prisma has no native LEAD/LAG. Works against the
 * `(assetId, occurredAt)` index.
 */
export async function custodyDurationsByAsset({
  organizationId,
  from,
  to,
}: ReportScope): Promise<CustodyWindow[]> {
  try {
    type Row = {
      asset_id: string;
      actor_user_id: string | null;
      held_from: Date;
      held_to: Date | null;
    };
    const rows = await db.$queryRaw<Row[]>`
      WITH paired AS (
        SELECT
          "assetId" AS asset_id,
          "actorUserId" AS actor_user_id,
          "occurredAt" AS held_from,
          LEAD("occurredAt") OVER (
            PARTITION BY "assetId"
            ORDER BY "occurredAt"
          ) AS next_at,
          LEAD(action) OVER (
            PARTITION BY "assetId"
            ORDER BY "occurredAt"
          ) AS next_action,
          action
        FROM "ActivityEvent"
        WHERE "organizationId" = ${organizationId}
          AND "assetId" IS NOT NULL
          AND action IN ('CUSTODY_ASSIGNED', 'CUSTODY_RELEASED')
          AND "occurredAt" >= ${from}
          AND "occurredAt" <= ${to}
      )
      SELECT
        asset_id,
        actor_user_id,
        held_from,
        CASE WHEN next_action = 'CUSTODY_RELEASED' THEN next_at ELSE NULL END AS held_to
      FROM paired
      WHERE action = 'CUSTODY_ASSIGNED'
      ORDER BY asset_id, held_from
    `;
    return rows.map((r) => ({
      assetId: r.asset_id,
      actorUserId: r.actor_user_id,
      heldFrom: r.held_from,
      heldTo: r.held_to,
      durationSeconds: r.held_to
        ? Math.round((r.held_to.getTime() - r.held_from.getTime()) / 1000)
        : null,
    }));
  } catch (cause) {
    throw wrap(cause, "custodyDurationsByAsset", { organizationId });
  }
}

// ---- internals ----

const reportEventSelect = {
  id: true,
  occurredAt: true,
  action: true,
  entityType: true,
  entityId: true,
  actorUserId: true,
  actorSnapshot: true,
  field: true,
  fromValue: true,
  toValue: true,
  meta: true,
} as const satisfies Prisma.ActivityEventSelect;

type PrismaReportRow = {
  id: string;
  occurredAt: Date;
  action: string;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  actorSnapshot: Prisma.JsonValue;
  field: string | null;
  fromValue: Prisma.JsonValue;
  toValue: Prisma.JsonValue;
  meta: Prisma.JsonValue;
};

function toReportEvent(row: PrismaReportRow): ReportEvent {
  return {
    id: row.id,
    occurredAt: row.occurredAt,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    actorUserId: row.actorUserId,
    actorSnapshot: (row.actorSnapshot as ActorSnapshot | null) ?? null,
    field: row.field,
    fromValue: row.fromValue,
    toValue: row.toValue,
    meta: row.meta,
  };
}

function wrap(
  cause: unknown,
  helper: string,
  additionalData: Record<string, unknown>
): ShelfError {
  return new ShelfError({
    cause,
    label: "Activity",
    message: `Failed to run activity report: ${helper}`,
    additionalData: { helper, ...additionalData },
  });
}
