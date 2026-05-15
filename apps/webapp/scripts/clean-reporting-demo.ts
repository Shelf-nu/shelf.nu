/**
 * Reporting Demo Data Cleanup (companion to the seeder)
 *
 * Deletes everything the `seed-reporting-demo` script wrote into a given
 * workspace, leaving any non-seeded rows untouched. Targets rows by the
 * two markers the seeder attaches:
 *
 * - `ActivityEvent.meta.seedRun === "reporting-demo-v1"` — used to find
 *   every seeded event.
 * - The `#seed:reporting-demo-v1` Tag (and the `" [seed]"` name suffix on
 *   entities that can't carry a tag) — used to find the source rows.
 *
 * Sanity check: before any `delete` runs, the script counts how many of
 * the org's assets / bookings / audit sessions are marked vs. total. If
 * fewer than 95% of any category are marked, the script aborts — that
 * means the org holds real data we don't own. Pass `--force` to override
 * (not recommended).
 *
 * Deletion order matches the FK cascade topology: children before
 * parents, events before the entities they reference. Everything runs in
 * a single `$transaction` so a mid-deletion failure leaves the workspace
 * in a clean state.
 *
 * Invocation (local dev):
 *   pnpm webapp:clean:reporting-demo -- --org-id <id> [--force]
 *
 * Invocation (staging):
 *   pnpm webapp:clean:reporting-demo:staging -- --org-id <id> [--force]
 */

import { createDatabaseClient } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";

import {
  NAME_SUFFIX,
  SEED_RUN_ID,
  SEED_TAG_NAME,
} from "./seed-reporting-demo/markers";

/** CLI options for the cleanup script. */
type CleanCliOptions = {
  orgId: string;
  force: boolean;
};

/**
 * Parse argv into `CleanCliOptions`. Smaller surface than the seeder — we
 * only need `--org-id` and `--force`.
 */
function parseArgs(argv: readonly string[]): CleanCliOptions {
  let orgId: string | undefined;
  let force = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--org-id": {
        const next = argv[i + 1];
        if (!next || next.startsWith("--")) {
          throw new Error("--org-id requires a value");
        }
        orgId = next;
        i++;
        break;
      }
      case "--force":
        force = true;
        break;
      case "--":
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!orgId) throw new Error("--org-id is required");
  return { orgId, force };
}

/** Human-readable usage. */
function printUsage(): void {
  console.log(
    `\nUsage:\n` +
      `  pnpm webapp:clean:reporting-demo -- --org-id <id> [--force]\n\n` +
      `Required:\n` +
      `  --org-id <id>  Target organization id.\n\n` +
      `Optional:\n` +
      `  --force        Skip the 95%-marked sanity check. Use with care —\n` +
      `                 only appropriate for an org that you know holds\n` +
      `                 nothing but seed data.\n`
  );
}

/** Entry point. */
async function main(): Promise<void> {
  let options: CleanCliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(
      `\nError: ${err instanceof Error ? err.message : String(err)}\n`
    );
    printUsage();
    process.exit(1);
  }

  const db = createDatabaseClient();

  try {
    await db.$connect();

    const org = await db.organization.findUnique({
      where: { id: options.orgId },
      select: { id: true, name: true },
    });
    if (!org) {
      throw new Error(`Organization ${options.orgId} does not exist.`);
    }

    console.log(
      `\n=== Reporting-demo cleanup (${SEED_RUN_ID}) ===\n` +
        `Target workspace:  ${org.name} (${org.id})\n`
    );

    const ratios = await collectMarkedRatios(db, options.orgId);
    printRatios(ratios);

    if (!options.force) {
      assertSafeToClean(ratios);
    } else {
      console.log("--force passed: skipping the 95%-marked sanity check.\n");
    }

    const deleted = await deleteAll(db, options.orgId);
    printDeleted(deleted);
  } finally {
    await db.$disconnect();
  }
}

/**
 * Per-entity mark ratios, used both for the sanity check and the
 * operator-facing summary. `marked` and `total` are plain counts.
 */
type MarkedRatios = {
  assets: { marked: number; total: number };
  bookings: { marked: number; total: number };
  audits: { marked: number; total: number };
  activityEvents: { marked: number; total: number };
};

/**
 * Count marked vs. total rows for the categories we'll delete. A marked
 * Asset is one connected to the `SEED_TAG_NAME` tag; a marked Booking
 * uses the same criterion; a marked AuditSession has a name ending in
 * the `" [seed]"` suffix; a marked ActivityEvent has `meta.seedRun`
 * set to the current `SEED_RUN_ID`.
 */
async function collectMarkedRatios(
  db: ExtendedPrismaClient,
  orgId: string
): Promise<MarkedRatios> {
  const [
    totalAssets,
    markedAssets,
    totalBookings,
    markedBookings,
    totalAudits,
    markedAudits,
    totalEvents,
    markedEvents,
  ] = await Promise.all([
    db.asset.count({ where: { organizationId: orgId } }),
    db.asset.count({
      where: {
        organizationId: orgId,
        tags: { some: { name: SEED_TAG_NAME } },
      },
    }),
    db.booking.count({ where: { organizationId: orgId } }),
    db.booking.count({
      where: {
        organizationId: orgId,
        tags: { some: { name: SEED_TAG_NAME } },
      },
    }),
    db.auditSession.count({ where: { organizationId: orgId } }),
    db.auditSession.count({
      where: {
        organizationId: orgId,
        name: { endsWith: NAME_SUFFIX },
      },
    }),
    db.activityEvent.count({ where: { organizationId: orgId } }),
    db.activityEvent.count({
      where: {
        organizationId: orgId,
        meta: { path: ["seedRun"], equals: SEED_RUN_ID },
      },
    }),
  ]);

  return {
    assets: { marked: markedAssets, total: totalAssets },
    bookings: { marked: markedBookings, total: totalBookings },
    audits: { marked: markedAudits, total: totalAudits },
    activityEvents: { marked: markedEvents, total: totalEvents },
  };
}

/** Log the ratios in a compact, scannable block. */
function printRatios(ratios: MarkedRatios): void {
  const fmt = (m: number, t: number) =>
    t === 0 ? "— (none)" : `${m}/${t} (${((m / t) * 100).toFixed(1)}%)`;
  console.log(
    "Marked-vs-total rows in this workspace:\n" +
      `  Assets          ${fmt(ratios.assets.marked, ratios.assets.total)}\n` +
      `  Bookings        ${fmt(
        ratios.bookings.marked,
        ratios.bookings.total
      )}\n` +
      `  Audits          ${fmt(ratios.audits.marked, ratios.audits.total)}\n` +
      `  Activity events ${fmt(
        ratios.activityEvents.marked,
        ratios.activityEvents.total
      )}\n`
  );
}

/**
 * Abort with a descriptive error if fewer than 95% of any entity type
 * are marked. Empty orgs (0/0) are treated as safe — nothing to delete.
 */
function assertSafeToClean(ratios: MarkedRatios): void {
  const MIN_MARKED_RATIO = 0.95;
  const offenders: string[] = [];
  const check = (name: string, r: { marked: number; total: number }): void => {
    if (r.total === 0) return;
    const ratio = r.marked / r.total;
    if (ratio < MIN_MARKED_RATIO) {
      offenders.push(
        `${name}: only ${(ratio * 100).toFixed(1)}% marked (${r.marked}/${
          r.total
        })`
      );
    }
  };
  check("Assets", ratios.assets);
  check("Bookings", ratios.bookings);
  check("Audits", ratios.audits);
  check("Activity events", ratios.activityEvents);

  if (offenders.length > 0) {
    throw new Error(
      "Refusing to clean: target workspace holds non-seeded rows.\n" +
        offenders.map((s) => `  - ${s}`).join("\n") +
        "\n\nIf this org is truly a pure seed workspace, re-run with `--force`."
    );
  }
}

/** Counts of rows deleted per entity, for the final summary log. */
type DeleteCounts = {
  activityEvents: number;
  auditScans: number;
  auditAssets: number;
  auditSessions: number;
  partialCheckins: number;
  bookings: number;
  custodies: number;
  kits: number;
  assets: number;
  customFields: number;
  tags: number;
  locations: number;
  categories: number;
  teamMembers: number;
};

/**
 * Delete every seeded row in cascade-safe order, inside one transaction.
 *
 * The order matters: children before parents, events before their
 * referenced entities. Prisma's `onDelete: Cascade` covers most joins,
 * but `ActivityEvent` intentionally has no relation block (append-only
 * log), so we delete events first.
 */
async function deleteAll(
  db: ExtendedPrismaClient,
  orgId: string
): Promise<DeleteCounts> {
  return db.$transaction(async (tx) => {
    const counts: DeleteCounts = {
      activityEvents: 0,
      auditScans: 0,
      auditAssets: 0,
      auditSessions: 0,
      partialCheckins: 0,
      bookings: 0,
      custodies: 0,
      kits: 0,
      assets: 0,
      customFields: 0,
      tags: 0,
      locations: 0,
      categories: 0,
      teamMembers: 0,
    };

    // Treat the tx client structurally — `$transaction` returns a narrower
    // type than `ExtendedPrismaClient`, but it supports every call we need.
    const t = tx as unknown as ExtendedPrismaClient;

    // 1) Seeded ActivityEvent rows (identified by meta.seedRun).
    const activityEventResult = await t.activityEvent.deleteMany({
      where: {
        organizationId: orgId,
        meta: { path: ["seedRun"], equals: SEED_RUN_ID },
      },
    });
    counts.activityEvents = activityEventResult.count;

    // 2) AuditScan rows attached to seeded audit sessions.
    const auditScanResult = await t.auditScan.deleteMany({
      where: {
        auditSession: {
          organizationId: orgId,
          name: { endsWith: NAME_SUFFIX },
        },
      },
    });
    counts.auditScans = auditScanResult.count;

    // 3) AuditAsset rows attached to seeded audit sessions.
    const auditAssetResult = await t.auditAsset.deleteMany({
      where: {
        auditSession: {
          organizationId: orgId,
          name: { endsWith: NAME_SUFFIX },
        },
      },
    });
    counts.auditAssets = auditAssetResult.count;

    // 4) AuditSession rows themselves.
    const auditSessionResult = await t.auditSession.deleteMany({
      where: { organizationId: orgId, name: { endsWith: NAME_SUFFIX } },
    });
    counts.auditSessions = auditSessionResult.count;

    // 5) PartialBookingCheckin rows attached to seeded bookings.
    const partialResult = await t.partialBookingCheckin.deleteMany({
      where: {
        booking: {
          organizationId: orgId,
          tags: { some: { name: SEED_TAG_NAME } },
        },
      },
    });
    counts.partialCheckins = partialResult.count;

    // 6) Booking rows (marker tag).
    const bookingResult = await t.booking.deleteMany({
      where: {
        organizationId: orgId,
        tags: { some: { name: SEED_TAG_NAME } },
      },
    });
    counts.bookings = bookingResult.count;

    // 7) Custody rows on seeded assets.
    const custodyResult = await t.custody.deleteMany({
      where: {
        asset: {
          organizationId: orgId,
          tags: { some: { name: SEED_TAG_NAME } },
        },
      },
    });
    counts.custodies = custodyResult.count;

    // 8) Kit rows (name suffix). `AssetKit` pivot rows cascade-delete
    // when the kit is deleted (FK is `ON DELETE CASCADE`), so no
    // explicit detach pass is needed. Assets themselves stay; only the
    // pivot link to the kit is cleared.
    const kitResult = await t.kit.deleteMany({
      where: { organizationId: orgId, name: { endsWith: NAME_SUFFIX } },
    });
    counts.kits = kitResult.count;

    // 9) Asset rows (marker tag).
    const assetResult = await t.asset.deleteMany({
      where: {
        organizationId: orgId,
        tags: { some: { name: SEED_TAG_NAME } },
      },
    });
    counts.assets = assetResult.count;

    // 10) CustomField rows (name suffix).
    const customFieldResult = await t.customField.deleteMany({
      where: { organizationId: orgId, name: { endsWith: NAME_SUFFIX } },
    });
    counts.customFields = customFieldResult.count;

    // 11) Tag rows — both the marker tag (exact name) and the content
    // tags with the `" [seed]"` suffix.
    const tagResult = await t.tag.deleteMany({
      where: {
        organizationId: orgId,
        OR: [{ name: SEED_TAG_NAME }, { name: { endsWith: NAME_SUFFIX } }],
      },
    });
    counts.tags = tagResult.count;

    // 12) Location rows (name suffix).
    const locationResult = await t.location.deleteMany({
      where: { organizationId: orgId, name: { endsWith: NAME_SUFFIX } },
    });
    counts.locations = locationResult.count;

    // 13) Category rows (name suffix).
    const categoryResult = await t.category.deleteMany({
      where: { organizationId: orgId, name: { endsWith: NAME_SUFFIX } },
    });
    counts.categories = categoryResult.count;

    // 14) TeamMember rows — only the fakes. Real-user TeamMembers are
    // distinguished by a non-null `userId`; fakes have `userId = null`
    // AND the seed name suffix.
    const teamMemberResult = await t.teamMember.deleteMany({
      where: {
        organizationId: orgId,
        userId: null,
        name: { endsWith: NAME_SUFFIX },
      },
    });
    counts.teamMembers = teamMemberResult.count;

    return counts;
  });
}

/** Log the deletion summary. */
function printDeleted(counts: DeleteCounts): void {
  console.log("\nCleanup complete. Rows deleted:");
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(20)} ${value}`);
  }
  console.log("");
}

main().catch((err) => {
  console.error(
    "\nCleanup failed:\n",
    err instanceof Error ? err.stack ?? err.message : err,
    "\n"
  );
  process.exit(1);
});
