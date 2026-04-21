/**
 * Activity Event Service
 *
 * Persists structured rows to the `ActivityEvent` table. This is the canonical
 * write-path for reporting data — called alongside (not in place of) existing
 * system-note writes. Every state-changing mutation that already writes an
 * UPDATE-type note should also call `recordEvent` inside the same transaction.
 *
 * See `.claude/rules/use-record-event.md` for usage rules and
 * `.claude/rules/record-event-payload-shapes.md` for per-field / per-item
 * granularity conventions.
 *
 * @see {@link file://./types.ts}
 * @see {@link file://./reports.server.ts}
 */

import type { Prisma } from "@prisma/client";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import type { ActivityEventInput, ActorSnapshot } from "./types";

/**
 * Minimum Prisma surface we need — both the top-level (extended) client and a
 * transaction client satisfy this, so callers can pass either. Typed
 * structurally because `ExtendedPrismaClient` (from `@shelf/database`) and
 * extended `Prisma.TransactionClient` are not directly assignable to the
 * generated `Prisma.TransactionClient`. Exported so this module's public API
 * can accept any caller's tx without type gymnastics at the call site.
 */
export type RecordEventTxClient = {
  activityEvent: {
    create: (args: {
      data: Prisma.ActivityEventUncheckedCreateInput;
    }) => Promise<unknown>;
  };
  user: {
    findUnique: (args: {
      where: { id: string };
      select: { firstName: true; lastName: true; displayName: true };
    }) => Promise<{
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
    } | null>;
  };
};

type PrismaLike = RecordEventTxClient;

/**
 * Persist a single activity event.
 *
 * Pass `tx` when called inside a Prisma interactive transaction so the event
 * commits atomically with the mutation. If `tx` is omitted, the event is
 * written immediately and cannot be rolled back with a caller's tx — prefer
 * passing it whenever the caller already runs in one.
 *
 * `actorSnapshot` is captured at write time so historical events survive
 * user rename / deletion. Callers may provide a pre-computed snapshot to
 * avoid an extra user fetch.
 *
 * @param input - Event payload (see `ActivityEventInput` union)
 * @param tx - Optional Prisma transaction client
 * @throws {ShelfError} with label "Activity" on DB failure
 */
export async function recordEvent(
  input: ActivityEventInput,
  tx?: PrismaLike
): Promise<void> {
  const client: PrismaLike = tx ?? db;

  try {
    const actorSnapshot = await resolveActorSnapshot(input, client);
    await client.activityEvent.create({
      data: toPrismaData(input, actorSnapshot),
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Activity",
      message: "Failed to record activity event.",
      additionalData: {
        action: input.action,
        organizationId: input.organizationId,
        entityId: input.entityId,
      },
    });
  }
}

/**
 * Persist many activity events.
 *
 * Used for bulk mutations that emit one event per affected entity — e.g.
 * `BOOKING_ASSETS_ADDED` when several assets are added in one action.
 * Actor snapshots are memoized per `actorUserId` so we only fetch each user
 * once even when writing many events.
 *
 * @param inputs - Array of event payloads
 * @param tx - Optional Prisma transaction client
 * @throws {ShelfError} with label "Activity" on DB failure
 */
export async function recordEvents(
  inputs: ActivityEventInput[],
  tx?: PrismaLike
): Promise<void> {
  if (inputs.length === 0) return;

  const client: PrismaLike = tx ?? db;

  try {
    // Memoize snapshots per actorUserId — no duplicate user fetches for bulk writes.
    const snapshotCache = new Map<string, ActorSnapshot | null>();

    for (const input of inputs) {
      const actorSnapshot = await resolveActorSnapshot(
        input,
        client,
        snapshotCache
      );
      await client.activityEvent.create({
        data: toPrismaData(input, actorSnapshot),
      });
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      label: "Activity",
      message: "Failed to record activity events.",
      additionalData: {
        count: inputs.length,
        firstAction: inputs[0]?.action,
        organizationId: inputs[0]?.organizationId,
      },
    });
  }
}

/**
 * Resolve the actor snapshot to persist with the event.
 *
 * Precedence:
 * 1. Caller-supplied `input.actorSnapshot` (they already had the user loaded).
 * 2. Cached snapshot by `actorUserId` (only used by `recordEvents`).
 * 3. Fresh DB lookup by `actorUserId`.
 * 4. `null` if there is no actor (system event).
 */
async function resolveActorSnapshot(
  input: ActivityEventInput,
  client: PrismaLike,
  cache?: Map<string, ActorSnapshot | null>
): Promise<ActorSnapshot | null> {
  if (input.actorSnapshot !== undefined) {
    return input.actorSnapshot;
  }
  const actorUserId = input.actorUserId ?? null;
  if (!actorUserId) {
    return null;
  }
  if (cache?.has(actorUserId)) {
    return cache.get(actorUserId) ?? null;
  }

  const user = await client.user.findUnique({
    where: { id: actorUserId },
    select: { firstName: true, lastName: true, displayName: true },
  });
  const snapshot: ActorSnapshot | null = user
    ? {
        firstName: user.firstName,
        lastName: user.lastName,
        displayName: user.displayName,
      }
    : null;

  cache?.set(actorUserId, snapshot);
  return snapshot;
}

/**
 * Build the Prisma `create` data payload from an event input + resolved snapshot.
 */
function toPrismaData(
  input: ActivityEventInput,
  actorSnapshot: ActorSnapshot | null
): Prisma.ActivityEventUncheckedCreateInput {
  const field = "field" in input ? input.field : null;
  const fromValue = "fromValue" in input ? input.fromValue : null;
  const toValue = "toValue" in input ? input.toValue : null;

  return {
    organizationId: input.organizationId,
    occurredAt: input.occurredAt,
    actorUserId: input.actorUserId ?? null,
    actorSnapshot: actorSnapshot as Prisma.InputJsonValue | undefined,
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
    fromValue: fromValue ?? undefined,
    toValue: toValue ?? undefined,
    meta: input.meta,
  };
}
