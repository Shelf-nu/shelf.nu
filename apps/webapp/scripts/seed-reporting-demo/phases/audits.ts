/**
 * Phase 6 — Audit sessions with scan trails.
 *
 * Generates 80 `AuditSession` rows spread across 12 months, each with:
 * - 15–30 expected `AuditAsset` rows.
 * - 0–5 unexpected `AuditAsset` rows (items "found" that weren't on the list).
 * - Matching `AuditScan` rows for everything flagged FOUND / UNEXPECTED.
 *
 * Outcome mix (roughly):
 *   ~75% COMPLETED — full lifecycle, with counters populated.
 *   ~10% ACTIVE — in progress now; partial scans, no completion event.
 *   ~5%  CANCELLED — created + maybe some scans, then cancelled.
 *   ~5%  ARCHIVED — completed then archived.
 *   ~5%  PENDING — just created, never started.
 *
 * Events per audit depend on the outcome (see `runAudit` below for the
 * full mapping). The most valuable read-side event is `AUDIT_COMPLETED`
 * which carries the full counter set in `meta` — directly consumed by
 * the `auditCompletionStats` report helper.
 */

import { faker } from "@faker-js/faker";

import type { ActivityEventInput } from "../../../app/modules/activity-event/types";
import type { SeederContext, SeederState } from "../context";
import { randomDateBetween, randomIntInRange } from "../distributions";
import { flushEvents } from "../event-flush";
import {
  auditArchivedEvent,
  auditAssetScannedEvent,
  auditAssetsAddedEvent,
  auditCancelledEvent,
  auditCompletedEvent,
  auditCreatedEvent,
  auditStartedEvent,
} from "../event-shapes";
import { NAME_SUFFIX } from "../markers";

/** Target number of audit sessions across the 12-month window. */
const TARGET_AUDITS = 80;

/** Expected assets per audit, both inclusive. */
const EXPECTED_PER_AUDIT_MIN = 15;
const EXPECTED_PER_AUDIT_MAX = 30;

/** Unexpected (surprise-found) assets per audit, both inclusive. */
const UNEXPECTED_PER_AUDIT_MIN = 0;
const UNEXPECTED_PER_AUDIT_MAX = 5;

/** Discrete audit outcomes — each gets a distinct event trail. */
type Outcome = "COMPLETED" | "ACTIVE" | "CANCELLED" | "ARCHIVED" | "PENDING";

/** Outcome probabilities. Must sum to 1.0. */
const OUTCOME_WEIGHTS: Readonly<Record<Outcome, number>> = {
  COMPLETED: 0.75,
  ACTIVE: 0.1,
  CANCELLED: 0.05,
  ARCHIVED: 0.05,
  PENDING: 0.05,
};

/** Fraction of expected assets scanned (FOUND), per COMPLETED/ARCHIVED audit. */
const FOUND_RATE_MIN = 0.7;
const FOUND_RATE_MAX = 0.95;

/**
 * Generate every audit session + its asset/scan rows + events.
 */
export async function runAuditsPhase(
  ctx: SeederContext,
  state: SeederState
): Promise<void> {
  if (state.assetIds.length === 0) {
    throw new Error(
      "runAuditsPhase: state.assetIds is empty — Phase 3 must run first."
    );
  }

  const events: ActivityEventInput[] = [];
  let auditAssetCount = 0;
  let auditScanCount = 0;

  for (let i = 0; i < TARGET_AUDITS; i++) {
    const createdAt = randomDateBetween(ctx.historyStart, ctx.now, ctx.rng);
    const outcome = pickOutcome(ctx);

    const { auditAssets, scans } = await runAudit(ctx, state, events, {
      index: i,
      createdAt,
      outcome,
    });

    auditAssetCount += auditAssets;
    auditScanCount += scans;
  }

  state.counts.auditSessions = state.auditSessionIds.length;
  state.counts.auditAssets = auditAssetCount;
  state.counts.auditScans = auditScanCount;
  state.counts.activityEvents += await flushEvents(ctx.db, events);
}

/**
 * Build and persist one audit session end-to-end. Mutates `events` and
 * returns the per-audit row counts the caller accumulates.
 */
async function runAudit(
  ctx: SeederContext,
  state: SeederState,
  events: ActivityEventInput[],
  args: { index: number; createdAt: Date; outcome: Outcome }
): Promise<{ auditAssets: number; scans: number }> {
  const creator = ctx.actors.pick(ctx.rng);
  const createdById = creator.userId ?? ctx.ownerUserId;

  // Pick expected assets + unexpected asset ids from the pool.
  const expectedCount = randomIntInRange(
    EXPECTED_PER_AUDIT_MIN,
    EXPECTED_PER_AUDIT_MAX,
    ctx.rng
  );
  const unexpectedCount =
    args.outcome === "COMPLETED" || args.outcome === "ARCHIVED"
      ? randomIntInRange(
          UNEXPECTED_PER_AUDIT_MIN,
          UNEXPECTED_PER_AUDIT_MAX,
          ctx.rng
        )
      : 0;

  const expectedAssets = pickDistinct(state.assetIds, expectedCount, ctx.rng);
  const unexpectedAssets = pickDistinct(
    state.assetIds.filter((id) => !expectedAssets.includes(id)),
    unexpectedCount,
    ctx.rng
  );

  // Resolve the outcome-specific timeline + counters.
  const shape = planAuditShape(ctx, args, {
    expectedCount: expectedAssets.length,
    unexpectedCount: unexpectedAssets.length,
  });

  // Status = final resolved status for the outcome.
  const session = await ctx.db.auditSession.create({
    data: {
      name: `${faker.commerce.department()} audit #${
        args.index + 1
      }${NAME_SUFFIX}`,
      description: faker.lorem.sentence({ min: 4, max: 10 }),
      createdById,
      organizationId: ctx.orgId,
      status: shape.finalStatus,
      createdAt: args.createdAt,
      dueDate: shape.dueDate,
      startedAt: shape.startedAt,
      completedAt: shape.completedAt,
      cancelledAt: shape.cancelledAt,
      expectedAssetCount: expectedAssets.length,
      foundAssetCount: shape.foundCount + shape.unexpectedScanned,
      missingAssetCount: shape.missingCount,
      unexpectedAssetCount: shape.unexpectedScanned,
    },
    select: { id: true },
  });
  state.auditSessionIds.push(session.id);

  // Insert AuditAsset rows — one per expected asset (status derived from
  // shape), plus one per unexpected asset (status UNEXPECTED, expected=false).
  const auditAssetRows = [
    ...expectedAssets.map((assetId, idx) => ({
      assetId,
      expected: true,
      status:
        idx < shape.foundCount
          ? "FOUND"
          : idx < shape.foundCount + shape.missingCount
          ? "MISSING"
          : "PENDING",
    })),
    ...unexpectedAssets.map((assetId) => ({
      assetId,
      expected: false,
      status: "UNEXPECTED" as const,
    })),
  ];

  // Bulk insert AuditAsset, then fetch ids so we can emit scan events.
  await ctx.db.auditAsset.createMany({
    data: auditAssetRows.map((r) => ({
      auditSessionId: session.id,
      assetId: r.assetId,
      expected: r.expected,
      status: r.status as "FOUND" | "MISSING" | "PENDING" | "UNEXPECTED",
    })),
  });
  const auditAssetsCreated = await ctx.db.auditAsset.findMany({
    where: { auditSessionId: session.id },
    select: { id: true, assetId: true, expected: true, status: true },
  });

  // AUDIT_CREATED + AUDIT_ASSETS_ADDED events always fire.
  events.push(
    auditCreatedEvent({
      organizationId: ctx.orgId,
      occurredAt: args.createdAt,
      actor: creator,
      auditSessionId: session.id,
      expectedAssetCount: expectedAssets.length,
    })
  );
  for (const aa of auditAssetsCreated.filter((r) => r.expected)) {
    events.push(
      auditAssetsAddedEvent({
        organizationId: ctx.orgId,
        occurredAt: args.createdAt,
        actor: creator,
        auditSessionId: session.id,
        auditAssetId: aa.id,
        assetId: aa.assetId,
      })
    );
  }

  // AUDIT_STARTED event for any outcome that reached ACTIVE.
  if (shape.startedAt) {
    events.push(
      auditStartedEvent({
        organizationId: ctx.orgId,
        occurredAt: shape.startedAt,
        actor: creator,
        auditSessionId: session.id,
      })
    );
  }

  // Create AuditScan rows + AUDIT_ASSET_SCANNED events for every FOUND /
  // UNEXPECTED asset. Scans are spread across the audit's active window.
  const scanRows: Array<{
    auditSessionId: string;
    auditAssetId: string;
    assetId: string;
    scannedById: string;
    scannedAt: Date;
  }> = [];
  const scannedAuditAssets = auditAssetsCreated.filter(
    (aa) => aa.status === "FOUND" || aa.status === "UNEXPECTED"
  );
  for (const aa of scannedAuditAssets) {
    const scannedAt =
      shape.startedAt && shape.scanWindowEnd
        ? randomDateBetween(shape.startedAt, shape.scanWindowEnd, ctx.rng)
        : args.createdAt;
    scanRows.push({
      auditSessionId: session.id,
      auditAssetId: aa.id,
      assetId: aa.assetId,
      scannedById: createdById,
      scannedAt,
    });
    events.push(
      auditAssetScannedEvent({
        organizationId: ctx.orgId,
        occurredAt: scannedAt,
        actor: creator,
        auditSessionId: session.id,
        auditAssetId: aa.id,
        assetId: aa.assetId,
        isExpected: aa.expected,
      })
    );
  }
  if (scanRows.length > 0) {
    await ctx.db.auditScan.createMany({
      data: scanRows.map((r) => ({
        auditSessionId: r.auditSessionId,
        auditAssetId: r.auditAssetId,
        assetId: r.assetId,
        scannedById: r.scannedById,
        scannedAt: r.scannedAt,
      })),
    });
  }

  // Outcome-terminal events.
  if (shape.completedAt && args.outcome !== "CANCELLED") {
    events.push(
      auditCompletedEvent({
        organizationId: ctx.orgId,
        occurredAt: shape.completedAt,
        actor: creator,
        auditSessionId: session.id,
        expectedCount: expectedAssets.length,
        foundCount: shape.foundCount,
        missingCount: shape.missingCount,
        unexpectedCount: shape.unexpectedScanned,
      })
    );
  }
  if (shape.cancelledAt) {
    events.push(
      auditCancelledEvent({
        organizationId: ctx.orgId,
        occurredAt: shape.cancelledAt,
        actor: creator,
        auditSessionId: session.id,
      })
    );
  }
  if (shape.archivedAt) {
    events.push(
      auditArchivedEvent({
        organizationId: ctx.orgId,
        occurredAt: shape.archivedAt,
        actor: creator,
        auditSessionId: session.id,
      })
    );
  }

  return {
    auditAssets: auditAssetsCreated.length,
    scans: scanRows.length,
  };
}

/**
 * Compute timeline + counter splits for a single audit based on its
 * outcome. Returns the shape `runAudit` uses to persist AuditSession,
 * AuditAsset rows, AuditScan rows, and events.
 */
function planAuditShape(
  ctx: SeederContext,
  args: { createdAt: Date; outcome: Outcome },
  sizes: { expectedCount: number; unexpectedCount: number }
): {
  finalStatus: "PENDING" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "ARCHIVED";
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  archivedAt: Date | null;
  dueDate: Date | null;
  scanWindowEnd: Date | null;
  foundCount: number;
  missingCount: number;
  unexpectedScanned: number;
} {
  const DAY = 24 * 60 * 60 * 1000;
  const daysAfter = (d: Date, days: number) =>
    new Date(d.getTime() + days * DAY);

  const foundRate =
    FOUND_RATE_MIN + ctx.rng() * (FOUND_RATE_MAX - FOUND_RATE_MIN);
  const fullFound = Math.round(sizes.expectedCount * foundRate);
  const fullMissing = sizes.expectedCount - fullFound;

  switch (args.outcome) {
    case "COMPLETED": {
      const startedAt = daysAfter(
        args.createdAt,
        randomIntInRange(1, 5, ctx.rng)
      );
      const completedAt = daysAfter(startedAt, randomIntInRange(1, 7, ctx.rng));
      return {
        finalStatus: "COMPLETED",
        startedAt,
        completedAt,
        cancelledAt: null,
        archivedAt: null,
        dueDate: daysAfter(args.createdAt, 7),
        scanWindowEnd: completedAt,
        foundCount: fullFound,
        missingCount: fullMissing,
        unexpectedScanned: sizes.unexpectedCount,
      };
    }
    case "ARCHIVED": {
      const startedAt = daysAfter(
        args.createdAt,
        randomIntInRange(1, 5, ctx.rng)
      );
      const completedAt = daysAfter(startedAt, randomIntInRange(1, 7, ctx.rng));
      const archivedAt = daysAfter(
        completedAt,
        randomIntInRange(1, 30, ctx.rng)
      );
      return {
        finalStatus: "ARCHIVED",
        startedAt,
        completedAt,
        cancelledAt: null,
        archivedAt,
        dueDate: daysAfter(args.createdAt, 7),
        scanWindowEnd: completedAt,
        foundCount: fullFound,
        missingCount: fullMissing,
        unexpectedScanned: sizes.unexpectedCount,
      };
    }
    case "ACTIVE": {
      // Currently in progress — started recently, some scans done, not
      // all expected assets resolved yet.
      const startedAt = daysAfter(ctx.now, -randomIntInRange(1, 5, ctx.rng));
      const progressRate = 0.3 + ctx.rng() * 0.5; // 30–80% scanned so far
      const foundSoFar = Math.round(fullFound * progressRate);
      const missingSoFar = 0; // not marked missing until completion
      return {
        finalStatus: "ACTIVE",
        startedAt,
        completedAt: null,
        cancelledAt: null,
        archivedAt: null,
        dueDate: daysAfter(ctx.now, randomIntInRange(2, 10, ctx.rng)),
        scanWindowEnd: ctx.now,
        foundCount: foundSoFar,
        missingCount: missingSoFar,
        unexpectedScanned: 0,
      };
    }
    case "CANCELLED": {
      const startedAt =
        ctx.rng() < 0.5
          ? daysAfter(args.createdAt, randomIntInRange(1, 3, ctx.rng))
          : null;
      const cancelledAt = startedAt
        ? daysAfter(startedAt, randomIntInRange(1, 5, ctx.rng))
        : daysAfter(args.createdAt, randomIntInRange(1, 3, ctx.rng));
      const partialFound = startedAt ? Math.round(fullFound * 0.2) : 0;
      return {
        finalStatus: "CANCELLED",
        startedAt,
        completedAt: null,
        cancelledAt,
        archivedAt: null,
        dueDate: daysAfter(args.createdAt, 7),
        scanWindowEnd: cancelledAt,
        foundCount: partialFound,
        missingCount: 0,
        unexpectedScanned: 0,
      };
    }
    case "PENDING": {
      // Just created, never started. No AuditAssets marked anything.
      return {
        finalStatus: "PENDING",
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        archivedAt: null,
        dueDate: daysAfter(args.createdAt, 14),
        scanWindowEnd: null,
        foundCount: 0,
        missingCount: 0,
        unexpectedScanned: 0,
      };
    }
  }
}

/** Weighted pick over the audit outcome enum. */
function pickOutcome(ctx: SeederContext): Outcome {
  const outcomes = Object.keys(OUTCOME_WEIGHTS) as Outcome[];
  const weights = outcomes.map((o) => OUTCOME_WEIGHTS[o]);
  const r = ctx.rng();
  let acc = 0;
  for (let i = 0; i < outcomes.length; i++) {
    acc += weights[i];
    if (r < acc) return outcomes[i];
  }
  return outcomes[outcomes.length - 1];
}

/** Sample `n` distinct items from `arr` without replacement. */
function pickDistinct<T>(arr: readonly T[], n: number, rng: () => number): T[] {
  const size = Math.min(n, arr.length);
  if (size === 0) return [];
  const pool = arr.slice();
  const out: T[] = [];
  for (let i = 0; i < size; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}
