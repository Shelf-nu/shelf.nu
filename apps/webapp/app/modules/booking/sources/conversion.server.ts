/**
 * Lazy conversion of legacy booking groups, and the in-memory group session
 * every booking-sources writer plans on.
 *
 * A group is every slice of one asset on one booking. A LEGACY group converts
 * the first time a booking path touches it with adoption enabled: its slices,
 * logs and shares are read under the asset lock, the conversion is planned in
 * memory ({@link planGroupConversion}), the pending units of each standalone
 * slice are allocated to sources, and the writer persists everything in one
 * `writeSourcePlan` call. A group whose out units do not fit its plan is
 * held back: nothing is written, the action proceeds with LEGACY behaviour,
 * and a Sentry info log records the raw numbers.
 *
 * Rules this module enforces:
 * - Every read that decides conversion or allocation runs after the asset
 *   lock. {@link lockGroupAssets} takes it (sorted, workspace-scoped, one
 *   statement); the callers take it before opening a session.
 * - The adoption flag gates converting LEGACY groups and nothing else. A
 *   converted group (a non-LEGACY slice or any share) stays maintained with the
 *   flag off, and a slice added to it is created KIT or AUTO. A slice added to
 *   a LEGACY or held-back group stays LEGACY.
 * - Voluntary transitions never put pending units on UNASSIGNED; they refuse
 *   with a 400 naming each source's free units. Involuntary transitions (a
 *   check-in) never refuse; what fits nowhere goes to UNASSIGNED, which is
 *   always short. Draft bookings hold nothing, so their allocation never
 *   refuses either; units that fit nowhere wait on UNASSIGNED until the
 *   booking is reserved, which admits them again.
 * - Admission: a voluntary change is admitted only when, at every source it
 *   adds demand to, this booking's whole remaining reservation there fits the
 *   free units over the window (capacity minus the peak of every other active
 *   booking's holds).
 *
 * @see {@link file://./conversion.ts} the pure conversion planner
 * @see {@link file://./repository.server.ts} the reader and writer of source rows
 * @see {@link file://./capacity.server.ts} free units per source
 * @see {@link file://./booking-sources.server.ts} the facade booking paths call
 */

import { AssetType } from "@prisma/client";
import * as Sentry from "@sentry/react-router";
import {
  allocateSources,
  allocateSourcesOrUnassigned,
  pendingOf,
  sourceKey,
} from "@shelf/quantity-control";
import type {
  AllocationPart,
  SourceFree,
  SourceRowState,
} from "@shelf/quantity-control";

import type { ExtendedPrismaClient } from "~/database/db.server";
import { lockAssetsForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import { SENTRY_DSN } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

import { computeFreeBySourceForPools } from "./capacity.server";
import type { CapacityTx } from "./capacity.server";
import { planGroupConversion } from "./conversion";
import { groupMapKey, loadGroupStates } from "./repository.server";
import type {
  GroupState,
  SourcePlanWrite,
  SourceRowWrite,
  SourcesTx,
} from "./repository.server";
import type {
  GroupKey,
  PlannedShare,
  SourceAllocationMode,
  Window,
} from "./types";

/**
 * The transaction client conversion and the facade need: the repository and
 * capacity models, raw queries for the asset lock, and the booking and
 * location reads of the facade.
 */
export type BookingSourcesTx = SourcesTx &
  CapacityTx &
  Pick<ExtendedPrismaClient, "$queryRaw" | "booking" | "location">;

/** What happened to a group: already converted, left LEGACY, or held back. */
export type GroupStatus = "converted" | "legacy" | "held_back";

/**
 * How pending units are allocated:
 * - `voluntary`: by the allocation rule, refusing with a 400 when no fixed
 *   set of sources covers the window;
 * - `involuntary`: by the rule, the rest on UNASSIGNED (never refuses);
 * - `draft`: as voluntary, but a booking that holds nothing never refuses, so
 *   the rest waits on UNASSIGNED.
 */
export type AllocationHow = "voluntary" | "involuntary" | "draft";

/** A source row being planned; `id` is set for a persisted row. */
export type WorkingRow = SourceRowState & { id?: string };

/** A slice being planned, with its rows before and after the plan. */
export type WorkingSlice = {
  /** `BookingAsset.id`. */
  id: string;
  /** Set for a kit-driven slice. */
  assetKitId: string | null;
  /** Booked units, kept in step with the planned change. */
  quantity: number;
  /** Lifetime units checked out (`D`). */
  checkedOutQuantity: number;
  /** The mode stored on the slice now. */
  originalMode: SourceAllocationMode;
  /** The mode the plan leaves it in. */
  mode: SourceAllocationMode;
  /** The rows the plan leaves; persisted rows keep their `id`. */
  rows: WorkingRow[];
  /** The persisted rows as read, keyed by `sourceKey`. */
  originalRows: Map<string, WorkingRow>;
};

/** A group being planned. */
export type WorkingGroup = {
  /** The group's identity. */
  key: GroupKey;
  /** What the session decided for the group. */
  status: GroupStatus;
  /** Every slice of a converted group; empty for LEGACY and held-back groups. */
  slices: WorkingSlice[];
  /** Shares conversion seeds; empty unless the group converts now. */
  insertShares: PlannedShare[];
  /**
   * Free units per loose source over the session window, excluding this
   * group's booking. Empty when the session did not need them.
   */
  free: SourceFree[];
};

/** Pending units of one slice that still need a source. */
export type PendingAllocation = {
  /** `groupMapKey` of the slice's group. */
  groupKey: string;
  /** The slice. */
  sliceId: string;
  /** Units to allocate. */
  quantity: number;
};

/** Everything one booking-sources call plans before its single write. */
export type GroupSession = {
  /** The trusted workspace id. */
  organizationId: string;
  /** Groups keyed by `groupMapKey`. */
  groups: Map<string, WorkingGroup>;
  /** Pending units conversion and adoption left for the caller to allocate. */
  pending: PendingAllocation[];
};

/** Source kinds that hold location or Unplaced capacity. */
const LOOSE_KINDS: ReadonlySet<SourceRowState["kind"]> = new Set([
  "LOCATION",
  "UNPLACED",
]);

/** A fresh row with nothing out, released or dispatched. */
function emptyRow(
  kind: SourceRowState["kind"],
  locationId: string | null
): WorkingRow {
  return {
    kind,
    locationId,
    quantity: 0,
    outQuantity: 0,
    releasedQuantity: 0,
    dispatchedTotal: 0,
    sharedQuantity: 0,
  };
}

/**
 * Locks the assets of a call, in one sorted, workspace-scoped statement, and
 * returns the quantity-tracked ones. Idempotent inside a transaction, so a
 * caller that already holds the lock loses nothing. Only quantity-tracked
 * pools have source rows; every other asset is left alone.
 *
 * @param tx - The caller's transaction
 * @param organizationId - The trusted workspace id
 * @param assetIds - Assets to lock; duplicates are ignored
 * @returns Ids of the locked quantity-tracked assets
 */
export async function lockGroupAssets(
  tx: BookingSourcesTx,
  organizationId: string,
  assetIds: string[]
): Promise<Set<string>> {
  const locked = await lockAssetsForQuantityUpdate(
    tx,
    assetIds,
    organizationId
  );
  return new Set(
    (locked ?? [])
      .filter((a) => a.type === AssetType.QUANTITY_TRACKED)
      .map((a) => a.id)
  );
}

/** A working slice from a persisted one. */
function toWorkingSlice(slice: GroupState["slices"][number]): WorkingSlice {
  const rows: WorkingRow[] = slice.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    locationId: r.locationId,
    quantity: r.quantity,
    outQuantity: r.outQuantity,
    releasedQuantity: r.releasedQuantity,
    dispatchedTotal: r.dispatchedTotal,
    sharedQuantity: r.sharedQuantity,
  }));
  return {
    id: slice.id,
    assetKitId: slice.assetKitId,
    quantity: slice.quantity,
    checkedOutQuantity: slice.checkedOutQuantity,
    originalMode: slice.mode,
    mode: slice.mode,
    rows,
    originalRows: new Map(rows.map((r) => [sourceKey(r), { ...r }])),
  };
}

/**
 * Gives a LEGACY slice of a converted group its first rows: a kit slice one
 * KIT row holding its whole quantity, a standalone slice AUTO with its whole
 * quantity pending for the caller to allocate. A slice new to a booking has
 * nothing out yet, so nothing else is seeded.
 */
function adoptSlice(
  slice: WorkingSlice,
  groupKey: string,
  pending: PendingAllocation[]
) {
  if (slice.assetKitId !== null) {
    slice.mode = "KIT";
    slice.rows = [{ ...emptyRow("KIT", null), quantity: slice.quantity }];
    return;
  }
  slice.mode = "AUTO";
  if (slice.quantity > 0) {
    pending.push({ groupKey, sliceId: slice.id, quantity: slice.quantity });
  }
}

/**
 * Records a held-back group: a pino info line and a Sentry info log with the
 * slice ids and their raw booked `Q`, dispatched `D` and candidate shares `S`.
 */
function reportHeldBack(
  key: GroupKey,
  slices: Array<{ id: string; Q: number; D: number; S: number }>
) {
  const message =
    "Booking sources: group held back, out units do not fit its plan";
  const details = {
    bookingId: key.bookingId,
    assetId: key.assetId,
    sliceIds: slices.map((s) => s.id).join(","),
    slices: JSON.stringify(slices),
  };
  Logger.info(message, details);
  if (SENTRY_DSN) {
    Sentry.logger.info(message, details);
  }
}

/**
 * Reads the groups under the caller's asset lock and plans what each becomes,
 * without writing anything.
 *
 * - Converted group: its slices with their rows; any LEGACY slice in it (a
 *   slice just added) is adopted (KIT or AUTO).
 * - LEGACY group with adoption off: left LEGACY.
 * - LEGACY group with adoption on: the slices that existed before this call
 *   are planned by {@link planGroupConversion} on their current (pre-change)
 *   quantities. Held back: nothing changes, every slice stays LEGACY, a Sentry
 *   info log is sent. Convert: seeded rows, modes and shares are kept in the
 *   session, the pending units of standalone slices are listed for the caller
 *   to allocate, and slices added in this call are adopted.
 * - A LEGACY group whose only slices are the ones added in this call converts
 *   by adoption when the flag is on.
 *
 * Free units per source are read for every group that ends converted when
 * `loadFree` is true, and always for a group that converts now (it decides
 * UNKNOWN versus UNPLACED carriers) or has a LEGACY slice to adopt.
 *
 * Queries: `loadGroupStates` (four), then `computeFreeBySourceForPools`
 * (five) once per distinct booking among the groups that need free units,
 * whatever the number of pools (one booking for every facade call).
 *
 * @param tx - The caller's transaction; the caller holds the booking and asset locks
 * @param args.organizationId - The trusted workspace id
 * @param args.groups - Groups to open, quantity-tracked assets only
 * @param args.adoptionEnabled - Whether LEGACY groups may convert
 * @param args.window - The window free units are measured over
 * @param args.newSliceIds - Slices added in this call; they never take part in
 *   a conversion plan and are adopted when their group ends converted
 * @param args.loadFree - Whether converted groups need free units
 * @returns The session to plan on
 */
export async function openGroupSession(
  tx: BookingSourcesTx,
  args: {
    organizationId: string;
    groups: GroupKey[];
    adoptionEnabled: boolean;
    window: Window;
    newSliceIds?: ReadonlySet<string>;
    loadFree: boolean;
  }
): Promise<GroupSession> {
  const { organizationId, adoptionEnabled, window, loadFree } = args;
  const newSliceIds = args.newSliceIds ?? new Set<string>();
  const session: GroupSession = {
    organizationId,
    groups: new Map(),
    pending: [],
  };
  if (args.groups.length === 0) return session;

  const states = await loadGroupStates(tx, {
    organizationId,
    groups: args.groups,
  });

  /** Whether a group can end converted in this session. */
  const mayConvert = (state: GroupState) =>
    state.converted || (adoptionEnabled && state.slices.length > 0);
  /** Whether a group converts now (needs placements for its carriers). */
  const convertsNow = (state: GroupState) =>
    !state.converted &&
    adoptionEnabled &&
    state.slices.some((s) => !newSliceIds.has(s.id));

  const needFree = [...states.values()].filter(
    (s) =>
      mayConvert(s) &&
      (loadFree ||
        convertsNow(s) ||
        // A LEGACY slice of a group that ends converted is adopted: allocated.
        s.slices.some((slice) => slice.mode === "LEGACY"))
  );
  // One batched read per booking: free units exclude that booking's holds.
  const assetsByBooking = new Map<string, string[]>();
  for (const s of needFree) {
    const list = assetsByBooking.get(s.key.bookingId) ?? [];
    list.push(s.key.assetId);
    assetsByBooking.set(s.key.bookingId, list);
  }
  const freeByBooking = new Map(
    await Promise.all(
      [...assetsByBooking].map(
        async ([bookingId, assetIds]) =>
          [
            bookingId,
            await computeFreeBySourceForPools(tx, {
              organizationId,
              assetIds,
              window,
              excludeBookingId: bookingId,
            }),
          ] as const
      )
    )
  );
  const freeByGroup = new Map(
    needFree.map((s) => [
      groupMapKey(s.key),
      freeByBooking.get(s.key.bookingId)?.get(s.key.assetId) ?? [],
    ])
  );

  for (const [mapKey, state] of states) {
    const free = freeByGroup.get(mapKey) ?? [];
    const group: WorkingGroup = {
      key: state.key,
      status: "legacy",
      slices: [],
      insertShares: [],
      free,
    };
    session.groups.set(mapKey, group);

    if (state.converted) {
      group.status = "converted";
      group.slices = state.slices.map(toWorkingSlice);
      for (const slice of group.slices) {
        if (slice.mode === "LEGACY") adoptSlice(slice, mapKey, session.pending);
      }
      continue;
    }
    if (!mayConvert(state)) continue;

    const existing = state.slices.filter((s) => !newSliceIds.has(s.id));
    const fresh = state.slices.filter((s) => newSliceIds.has(s.id));

    if (existing.length > 0) {
      const plan = planGroupConversion({
        slices: existing,
        logs: state.logs,
        poolHasPlacements: free.some((f) => f.kind === "LOCATION"),
      });
      if (plan.status === "held_back") {
        group.status = "held_back";
        reportHeldBack(state.key, plan.slices);
        continue;
      }
      group.insertShares = plan.shares;
      for (const s of existing) {
        const slice = toWorkingSlice(s);
        slice.rows = plan.rowsBySlice.get(s.id) ?? [];
        slice.mode = plan.modeBySlice.get(s.id) ?? slice.mode;
        group.slices.push(slice);
        const pending = plan.pendingToAllocateBySlice.get(s.id) ?? 0;
        if (pending > 0) {
          session.pending.push({
            groupKey: mapKey,
            sliceId: s.id,
            quantity: pending,
          });
        }
      }
    }
    group.status = "converted";
    for (const s of fresh) {
      const slice = toWorkingSlice(s);
      group.slices.push(slice);
      adoptSlice(slice, mapKey, session.pending);
    }
  }
  return session;
}

/**
 * This booking's remaining reservation (`quantity - released`) at each loose
 * source of one group, over every slice of the group.
 *
 * @param group - The group
 * @param skipSliceId - A slice to leave out
 * @returns sourceKey -> units
 */
export function ownHoldBySource(
  group: WorkingGroup,
  skipSliceId?: string
): Map<string, number> {
  const held = new Map<string, number>();
  for (const slice of group.slices) {
    if (slice.id === skipSliceId) continue;
    for (const row of slice.rows) {
      if (!LOOSE_KINDS.has(row.kind)) continue;
      const key = sourceKey(row);
      held.set(key, (held.get(key) ?? 0) + row.quantity - row.releasedQuantity);
    }
  }
  return held;
}

/**
 * Free units per source left for more demand from this booking: the group's
 * free units minus what the booking already holds there, floored at 0.
 *
 * @param group - The group
 * @param skipSliceId - A slice whose holds are left out
 * @returns The sources in allocation order, with `free` reduced
 */
export function availableForBooking(
  group: WorkingGroup,
  skipSliceId?: string
): SourceFree[] {
  const held = ownHoldBySource(group, skipSliceId);
  return group.free.map((s) => ({
    ...s,
    free: Math.max(0, s.free - (held.get(sourceKey(s)) ?? 0)),
  }));
}

/** Finds a slice of a group, or fails loudly: a bug in the caller. */
export function sliceOf(group: WorkingGroup, sliceId: string): WorkingSlice {
  const slice = group.slices.find((s) => s.id === sliceId);
  if (!slice) {
    throw new ShelfError({
      cause: null,
      title: "Booking sources",
      message: "A booking slice is missing from its group.",
      additionalData: { sliceId, ...group.key },
      label: "Booking",
      status: 500,
    });
  }
  return slice;
}

/** Adds units to a slice's row of a source, creating the row when absent. */
export function addToRow(
  slice: WorkingSlice,
  kind: SourceRowState["kind"],
  locationId: string | null,
  units: number
) {
  if (units === 0) return;
  const key = sourceKey({ kind, locationId });
  let row = slice.rows.find((r) => sourceKey(r) === key);
  if (!row) {
    row = emptyRow(kind, locationId);
    slice.rows.push(row);
  }
  row.quantity += units;
}

/** Applies allocated parts and an UNASSIGNED remainder to a slice. */
export function applyAllocation(
  slice: WorkingSlice,
  parts: AllocationPart[],
  unassigned: number
) {
  for (const p of parts) addToRow(slice, p.kind, p.locationId, p.quantity);
  addToRow(slice, "UNASSIGNED", null, unassigned);
}

/**
 * Removes every pending unit from a slice's loose and UNASSIGNED rows and
 * returns how many there were. Out and released units stay on their rows.
 */
export function stripLoosePending(slice: WorkingSlice): number {
  let removed = 0;
  for (const row of slice.rows) {
    if (!LOOSE_KINDS.has(row.kind) && row.kind !== "UNASSIGNED") continue;
    const pending = pendingOf(row);
    row.quantity -= pending;
    removed += pending;
  }
  return removed;
}

/** One source in a refusal message. */
export type RefusalEntry = Pick<SourceFree, "kind" | "locationId" | "free">;

/** "A", "A and B", "A, B and C". */
function joinNames(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Builds the 400 a voluntary change gets when the sources cannot take it,
 * naming each source with its free units, e.g.
 * `Not enough units at Demo Warehouse (3 free) and Unplaced (0 free) for these dates.`
 * Reads the location names in one query.
 *
 * @param tx - The caller's transaction
 * @param organizationId - The trusted workspace id
 * @param group - The group refused, recorded for support
 * @param entries - The sources to name, in order
 * @returns The error to throw; nothing has been written
 */
export async function buildSourceRefusal(
  tx: BookingSourcesTx,
  organizationId: string,
  group: GroupKey,
  entries: RefusalEntry[]
): Promise<ShelfError> {
  const locationIds = [
    ...new Set(
      entries.flatMap((e) => (e.locationId === null ? [] : [e.locationId]))
    ),
  ];
  const locations =
    locationIds.length === 0
      ? []
      : await tx.location.findMany({
          where: { id: { in: locationIds }, organizationId },
          select: { id: true, name: true },
        });
  const nameById = new Map(locations.map((l) => [l.id, l.name]));
  // Locations first, the unplaced units last, as the booking page lists them.
  const ordered = [
    ...entries.filter((e) => e.kind !== "UNPLACED"),
    ...entries.filter((e) => e.kind === "UNPLACED"),
  ];
  const described = ordered.map((e) => {
    const name =
      e.kind === "UNPLACED"
        ? "Unplaced"
        : (e.locationId && nameById.get(e.locationId)) || "Unknown location";
    return `${name} (${Math.max(0, e.free)} free)`;
  });
  return new ShelfError({
    cause: null,
    title: "Not enough units",
    message: `Not enough units at ${joinNames(described)} for these dates.`,
    additionalData: { ...group, organizationId },
    label: "Booking",
    status: 400,
    shouldBeCaptured: false,
  });
}

/**
 * Allocates pending units of one slice to sources, by the allocation rule,
 * against the free units left for this booking.
 *
 * @param tx - The caller's transaction (location names for a refusal)
 * @param session - The session
 * @param group - The slice's group
 * @param slice - The slice receiving the units
 * @param quantity - Units to allocate
 * @param how - Refuse (voluntary), or put the rest on UNASSIGNED (involuntary, draft)
 * @param onlyKeys - Restricts the candidate sources (a MANUAL slice keeps its own)
 * @throws {ShelfError} 400 on a voluntary refusal, naming each candidate's free units
 */
export async function allocateToSlice(
  tx: BookingSourcesTx,
  session: GroupSession,
  group: WorkingGroup,
  slice: WorkingSlice,
  quantity: number,
  how: AllocationHow,
  onlyKeys?: ReadonlySet<string>
): Promise<void> {
  if (quantity <= 0) return;
  const sources = availableForBooking(group).filter(
    (s) => !onlyKeys || onlyKeys.has(sourceKey(s))
  );
  if (how === "involuntary") {
    const r = allocateSourcesOrUnassigned({ quantity, sources });
    applyAllocation(slice, r.parts, r.unassigned);
    return;
  }
  const r = allocateSources({ quantity, sources });
  if (r.ok) {
    applyAllocation(slice, r.parts, 0);
    return;
  }
  if (how === "draft") {
    const fallback = allocateSourcesOrUnassigned({ quantity, sources });
    applyAllocation(slice, fallback.parts, fallback.unassigned);
    return;
  }
  throw await buildSourceRefusal(
    tx,
    session.organizationId,
    group.key,
    r.freeBySource
  );
}

/**
 * Allocates every pending unit conversion and adoption left in the session.
 *
 * @param tx - The caller's transaction
 * @param session - The session
 * @param how - How a shortfall is handled
 * @throws {ShelfError} 400 on a voluntary refusal; nothing has been written
 */
export async function allocateSessionPending(
  tx: BookingSourcesTx,
  session: GroupSession,
  how: AllocationHow
): Promise<void> {
  const pending = session.pending;
  session.pending = [];
  for (const item of pending) {
    const group = session.groups.get(item.groupKey);
    if (!group) continue;
    await allocateToSlice(
      tx,
      session,
      group,
      sliceOf(group, item.sliceId),
      item.quantity,
      how
    );
  }
}

/** True when two rows carry the same counters. */
function sameCounters(a: SourceRowState, b: SourceRowState): boolean {
  return (
    a.quantity === b.quantity &&
    a.outQuantity === b.outQuantity &&
    a.releasedQuantity === b.releasedQuantity &&
    a.dispatchedTotal === b.dispatchedTotal
  );
}

/**
 * Turns a session into the one plan `writeSourcePlan` persists: every
 * new or changed row, the seeded shares, and every mode change (moving off
 * LEGACY stamps `sourcesConvertedAt`). Rows that end empty are dropped by the
 * repository.
 *
 * @param session - The planned session
 * @returns The plan; empty when nothing changed
 */
export function buildSessionPlan(session: GroupSession): SourcePlanWrite {
  const plan: SourcePlanWrite = {
    upsertRows: [],
    deleteRowIds: [],
    insertShares: [],
    repointShares: [],
    setModes: [],
  };
  for (const group of session.groups.values()) {
    if (group.status !== "converted") continue;
    plan.insertShares.push(...group.insertShares);
    for (const slice of group.slices) {
      if (slice.mode !== slice.originalMode) {
        plan.setModes.push({ bookingAssetId: slice.id, mode: slice.mode });
      }
      for (const row of slice.rows) {
        const before = slice.originalRows.get(sourceKey(row));
        if (before && sameCounters(before, row)) continue;
        const write: SourceRowWrite = {
          bookingAssetId: slice.id,
          kind: row.kind,
          locationId: row.locationId,
          quantity: row.quantity,
          outQuantity: row.outQuantity,
          releasedQuantity: row.releasedQuantity,
          dispatchedTotal: row.dispatchedTotal,
        };
        plan.upsertRows.push(write);
      }
    }
  }
  return plan;
}
