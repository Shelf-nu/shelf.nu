/**
 * Bulk event-flush helper for the reporting-demo seeder.
 *
 * Takes a batch of `ActivityEventInput` values and inserts them via
 * `db.activityEvent.createMany`. Unlike the runtime `recordEvents` service
 * (which issues one `create` per event so it can do actor snapshots and
 * per-row error wrapping), the seeder has all snapshots resolved up-front
 * via the `ActorPool`, so `createMany` is both correct and ~1000× faster
 * for the ~25k-row insert budget.
 *
 * The helper projects an `ActivityEventInput` onto Prisma's
 * `ActivityEventCreateManyInput` shape — same mapping `recordEvent` uses
 * internally, just without the snapshot fetch.
 */

import type { Prisma } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";

import type { ActivityEventInput } from "../../app/modules/activity-event/types";

/**
 * Insert a batch of events. Chunks to avoid the Postgres parameter limit
 * (~65k placeholders per statement); `createMany` serialises columns, so
 * a 15-column row fits ~4000 rows per batch comfortably — we use 1000 as
 * a conservative default.
 *
 * @param db - Prisma client (extended).
 * @param events - Fully-formed events with actor snapshots already resolved.
 * @returns Number of rows inserted.
 */
export async function flushEvents(
  db: ExtendedPrismaClient,
  events: ActivityEventInput[]
): Promise<number> {
  if (events.length === 0) return 0;

  const data = events.map(toCreateManyInput);

  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < data.length; i += CHUNK) {
    const slice = data.slice(i, i + CHUNK);
    const result = await db.activityEvent.createMany({ data: slice });
    written += result.count;
  }
  return written;
}

/**
 * Project an `ActivityEventInput` into the `createMany` row shape. Mirrors
 * `toPrismaData` in `apps/webapp/app/modules/activity-event/service.server.ts`,
 * minus the snapshot fetch (seeders supply the snapshot via `Actor`).
 */
function toCreateManyInput(
  input: ActivityEventInput
): Prisma.ActivityEventCreateManyInput {
  const field = "field" in input ? input.field : null;
  const fromValue = "fromValue" in input ? input.fromValue : null;
  const toValue = "toValue" in input ? input.toValue : null;

  return {
    organizationId: input.organizationId,
    occurredAt: input.occurredAt,
    actorUserId: input.actorUserId ?? null,
    actorSnapshot: (input.actorSnapshot ?? null) as
      | Prisma.InputJsonValue
      | typeof Prisma.JsonNull,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    assetId: input.assetId ?? null,
    bookingId: input.bookingId ?? null,
    auditSessionId: input.auditSessionId ?? null,
    auditAssetId: input.auditAssetId ?? null,
    kitId: input.kitId ?? null,
    locationId: input.locationId ?? null,
    teamMemberId: input.teamMemberId ?? null,
    targetUserId: input.targetUserId ?? null,
    field,
    fromValue: (fromValue ?? undefined) as Prisma.InputJsonValue | undefined,
    toValue: (toValue ?? undefined) as Prisma.InputJsonValue | undefined,
    meta: input.meta,
  };
}
