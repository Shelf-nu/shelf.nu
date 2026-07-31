/**
 * Performance-testing seeder (p95 rig).
 *
 * Fills a COMPLETELY EMPTY database (fresh `prisma migrate deploy`) with a
 * single TEAM workspace holding enough volume to exercise p95 latencies:
 *
 *   1 User (id/email from env) + 1 TEAM Organization "Perf Test Org"
 *   30 categories, 60 tags, 50 locations, 8 custom fields
 *   120 kits, 5000 assets (~85% INDIVIDUAL / ~15% QUANTITY_TRACKED)
 *   26 team members (25 non-registered + owner), ~600 custodies
 *   400 bookings (status mix) with 5-40 assets each
 *   1 Qr per asset, ~15000 notes, ~3000 scans
 *
 * Required env vars (besides DATABASE_URL / DIRECT_URL):
 *   SEED_USER_ID    - uuid of the primary user (Supabase auth id)
 *   SEED_USER_EMAIL - email of the primary user
 *
 * Run from apps/webapp:
 *   ../../node_modules/.bin/dotenv -e ../../.env -- npx tsx scripts/seed-perf.ts
 *
 * Design notes:
 * - Deterministic: all randomness flows through a seeded mulberry32 RNG and a
 *   counter-based cuid-shaped id generator, so re-runs produce the same shape.
 * - createMany in chunks of 500-1000 everywhere; the only nested creates are
 *   the User and the Organization (which mirrors `createOrganization` in
 *   app/modules/organization/service.server.ts: UserOrganization OWNER row,
 *   owner TeamMember, AssetIndexSettings, WorkingHours, BookingSettings).
 * - Asset<->Tag is Prisma-implicit m2m; rows go straight into "_AssetToTag"
 *   via $executeRaw (columns "A" = assetId, "B" = tagId, verified against
 *   migration 20230613115426_adding_tags_model_to_db).
 * - Sequential asset ids are written directly (SAM-0001...) and the org's
 *   Postgres sequence is then advanced via reset_asset_sequence_for_org()
 *   so app-side asset creation doesn't collide.
 * - Respects DB triggers: INDIVIDUAL assets get at most one AssetKit row,
 *   one AssetLocation row and one Custody row; QUANTITY_TRACKED pivot
 *   quantities never exceed Asset.quantity.
 *
 * @see {@link file://./seed-reporting-demo.ts} - conventions mirrored here
 * @see {@link file://../../../packages/database/prisma/schema.prisma}
 */

import { Prisma } from "@prisma/client";

import { createDatabaseClient } from "@shelf/database";
import type { ExtendedPrismaClient } from "@shelf/database";

/* ------------------------------------------------------------------ */
/* Targets                                                            */
/* ------------------------------------------------------------------ */

const TARGETS = {
  categories: 30,
  tags: 60,
  locations: 50,
  customFields: 8,
  kits: 120,
  assets: 5_000,
  nonRegisteredTeamMembers: 25,
  custodies: 600,
  bookings: 400,
  notes: 15_000,
  scans: 3_000,
} as const;

/** Fractions used when decorating assets. */
const FRACTIONS = {
  quantityTracked: 0.15,
  inKit: 0.4,
  withCategory: 0.7,
  withTags: 0.5,
  withLocation: 0.6,
  withCustomFieldValues: 0.6,
} as const;

/** Booking status mix (sums to TARGETS.bookings). */
const BOOKING_STATUS_PLAN: Array<{
  status: Prisma.BookingCreateManyInput["status"];
  count: number;
}> = [
  { status: "COMPLETE", count: 100 },
  { status: "ONGOING", count: 50 },
  { status: "RESERVED", count: 80 },
  { status: "DRAFT", count: 100 },
  { status: "OVERDUE", count: 30 },
  { status: "CANCELLED", count: 25 },
  { status: "ARCHIVED", count: 15 },
];

const BATCH_SIZE = 1_000;
const RNG_SEED = 20260723; // fixed; change to reshuffle the data

/* ------------------------------------------------------------------ */
/* Deterministic randomness + ids                                     */
/* ------------------------------------------------------------------ */

/** mulberry32 - tiny deterministic PRNG, no external deps. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(RNG_SEED);

const BASE36 = "abcdefghijklmnopqrstuvwxyz0123456789";
let idCounter = 0;

/**
 * Deterministic cuid-shaped id: "c" + 8-char base36 counter + 16 random
 * base36 chars = 25 chars, passes zod's `.cuid()` shape check and is
 * collision-free thanks to the embedded counter.
 */
function pid(): string {
  idCounter += 1;
  const counterPart = idCounter.toString(36).padStart(8, "0");
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand += BASE36[Math.floor(rng() * BASE36.length)];
  }
  return `c${counterPart}${rand}`;
}

/** Integer in [min, max] inclusive. */
function randInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function chance(p: number): boolean {
  return rng() < p;
}

function pick<T>(arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick: empty array");
  return arr[Math.floor(rng() * arr.length)];
}

/** n distinct items via partial Fisher-Yates (caps at arr.length). */
function pickN<T>(arr: readonly T[], n: number): T[] {
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

const DAY_MS = 24 * 60 * 60 * 1000;

/** Random date in [start, end]. */
function randomDate(start: Date, end: Date): Date {
  return new Date(
    start.getTime() + rng() * (end.getTime() - start.getTime())
  );
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

/* ------------------------------------------------------------------ */
/* Word lists (no faker - keep the script dependency-free)            */
/* ------------------------------------------------------------------ */

const ADJECTIVES = [
  "Rugged", "Compact", "Wireless", "Heavy-Duty", "Portable", "Digital",
  "Industrial", "Precision", "Modular", "Ergonomic", "Refurbished",
  "Calibrated", "Waterproof", "High-Torque", "Lightweight", "Certified",
];
const NOUNS = [
  "Drill", "Camera", "Laptop", "Tripod", "Projector", "Scanner", "Monitor",
  "Generator", "Microphone", "Mixer", "Router", "Sensor", "Charger",
  "Toolkit", "Headset", "Lens", "Battery Pack", "Light Panel", "Cable Reel",
  "Multimeter",
];
const BRANDS = [
  "Makita", "Canon", "Dell", "Sony", "Bosch", "DeWalt", "Panasonic",
  "Lenovo", "Shure", "Ubiquiti", "Fluke", "Manfrotto",
];
const FIRST_NAMES = [
  "Alex", "Sam", "Jordan", "Casey", "Riley", "Morgan", "Taylor", "Jamie",
  "Quinn", "Avery", "Dana", "Robin", "Lee", "Kim", "Pat", "Chris", "Noor",
  "Ivan", "Mila", "Omar", "Lena", "Hugo", "Nina", "Piet", "Sofia",
];
const LAST_NAMES = [
  "Johnson", "Smith", "Garcia", "Miller", "Davis", "Martinez", "Lopez",
  "Wilson", "Anderson", "Thomas", "Moore", "Jackson", "deVries", "Bakker",
  "Novak", "Kovacs", "Ivanov", "Petrov", "Kim", "Nguyen",
];
const NOTE_SNIPPETS = [
  "Inspected on arrival, no visible damage.",
  "Battery replaced during routine maintenance.",
  "Returned late from previous booking, flagged for review.",
  "Firmware updated to latest vendor release.",
  "Minor cosmetic scratches on the casing.",
  "Calibration certificate renewed.",
  "Cleaned and repacked into protective case.",
  "Reported intermittent power issue, could not reproduce.",
  "Label reprinted after wear.",
  "Spare parts ordered from vendor.",
  "Checked against inventory list during spot audit.",
  "Assigned protective sleeve and lock.",
];
const USER_AGENTS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/125.0",
  "ShelfCompanion/1.1.0 (iOS 17.5)",
];

/* ------------------------------------------------------------------ */
/* AssetIndexSettings default columns                                  */
/* ------------------------------------------------------------------ */

/**
 * Inlined copy of `defaultFields` from
 * app/modules/asset-index-settings/helpers.ts (kept standalone so the script
 * never drags webapp server modules in). Custom-field columns (`cf_<name>`)
 * are appended below, matching what the runtime column sync produces.
 */
const DEFAULT_INDEX_COLUMNS = [
  { name: "id", visible: false, position: 0 },
  { name: "sequentialId", visible: true, position: 1 },
  { name: "qrId", visible: true, position: 2 },
  { name: "status", visible: true, position: 3 },
  { name: "description", visible: true, position: 4 },
  { name: "valuation", visible: true, position: 5 },
  { name: "availableToBook", visible: true, position: 6 },
  { name: "createdAt", visible: true, position: 7 },
  { name: "updatedAt", visible: true, position: 8 },
  { name: "category", visible: true, position: 9 },
  { name: "tags", visible: true, position: 10 },
  { name: "location", visible: true, position: 11 },
  { name: "kit", visible: true, position: 12 },
  { name: "custody", visible: true, position: 13 },
  { name: "upcomingReminder", visible: true, position: 14 },
  { name: "actions", visible: true, position: 15 },
  { name: "upcomingBookings", visible: true, position: 16 },
  { name: "quantity", visible: false, position: 17 },
  { name: "type", visible: false, position: 18 },
  { name: "assetModel", visible: false, position: 19 },
];

/* ------------------------------------------------------------------ */
/* Custom field plan                                                  */
/* ------------------------------------------------------------------ */

type CustomFieldPlan = {
  id: string;
  name: string;
  type: NonNullable<Prisma.CustomFieldCreateManyInput["type"]>;
  options: string[];
};

const CONDITION_OPTIONS = ["New", "Good", "Fair", "Poor"];
const DEPARTMENT_OPTIONS = [
  "Engineering",
  "Facilities",
  "Media",
  "Field Ops",
  "IT",
];

/** 8 org-scoped custom fields: 3x TEXT, 2x DATE, 2x OPTION, 1x BOOLEAN. */
function buildCustomFieldPlans(): CustomFieldPlan[] {
  return [
    { id: pid(), name: "Serial Number", type: "TEXT", options: [] },
    { id: pid(), name: "Vendor", type: "TEXT", options: [] },
    { id: pid(), name: "PO Number", type: "TEXT", options: [] },
    { id: pid(), name: "Purchase Date", type: "DATE", options: [] },
    { id: pid(), name: "Warranty Expiry", type: "DATE", options: [] },
    { id: pid(), name: "Condition", type: "OPTION", options: CONDITION_OPTIONS },
    { id: pid(), name: "Department", type: "OPTION", options: DEPARTMENT_OPTIONS },
    { id: pid(), name: "Insured", type: "BOOLEAN", options: [] },
  ];
}

/**
 * Build the JSON value for an AssetCustomFieldValue row. Shapes mirror
 * `buildCustomFieldValue` in app/utils/custom-fields.ts and satisfy the
 * `ensure_value_structure_and_types` CHECK constraint (raw + one typed key).
 */
function buildCfValue(cf: CustomFieldPlan): Prisma.InputJsonValue {
  switch (cf.type) {
    case "TEXT": {
      const text =
        cf.name === "Serial Number"
          ? `SN-${randInt(100000, 999999)}-${pick(BASE36.split("")).toUpperCase()}`
          : cf.name === "Vendor"
            ? pick(BRANDS)
            : `PO-${randInt(2023, 2026)}-${randInt(1000, 9999)}`;
      return { raw: text, valueText: text };
    }
    case "DATE": {
      const d = randomDate(daysFromNow(-1095), daysFromNow(365));
      const dateOnly = d.toISOString().slice(0, 10); // YYYY-MM-DD
      const utcMidnight = new Date(`${dateOnly}T00:00:00.000Z`);
      return { raw: dateOnly, valueDate: utcMidnight.toISOString() };
    }
    case "OPTION": {
      const opt = pick(cf.options);
      return { raw: opt, valueOption: opt };
    }
    case "BOOLEAN": {
      const val = chance(0.5);
      return { raw: val, valueBoolean: val };
    }
    default:
      throw new Error(`Unhandled custom field type: ${cf.type}`);
  }
}

/* ------------------------------------------------------------------ */
/* Batch helper                                                       */
/* ------------------------------------------------------------------ */

/** Run createMany in chunks; returns total inserted. */
async function batchedCreateMany<T>(
  rows: T[],
  createMany: (chunk: T[]) => Promise<{ count: number }>,
  label: string
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const res = await createMany(chunk);
    total += res.count;
    process.stdout.write(
      `\r  ${label}: ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`
    );
  }
  process.stdout.write("\n");
  return total;
}

/* ------------------------------------------------------------------ */
/* Main                                                               */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const SEED_USER_ID = process.env.SEED_USER_ID;
  const SEED_USER_EMAIL = process.env.SEED_USER_EMAIL;

  if (!SEED_USER_ID || !SEED_USER_EMAIL) {
    console.error(
      "Missing env vars. Set SEED_USER_ID (uuid) and SEED_USER_EMAIL."
    );
    process.exit(1);
  }
  if (!/^[0-9a-f-]{36}$/i.test(SEED_USER_ID)) {
    console.error(`SEED_USER_ID does not look like a uuid: ${SEED_USER_ID}`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run via dotenv -e ../../.env.");
    process.exit(1);
  }

  const db = createDatabaseClient();
  const startedAt = Date.now();

  try {
    await db.$connect();

    // Idempotence guard: this seeder assumes an empty DB.
    const existingUser = await db.user.findUnique({
      where: { id: SEED_USER_ID },
      select: { id: true },
    });
    if (existingUser) {
      throw new Error(
        `User ${SEED_USER_ID} already exists. This seeder expects a freshly ` +
          "migrated, empty database. Reset the DB and re-run."
      );
    }

    /* ---------------------------------------------------------- */
    /* 1. Primary user                                            */
    /* ---------------------------------------------------------- */
    console.log("1/12 Creating primary user...");
    const username =
      SEED_USER_EMAIL.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "") + "-perf";
    await db.user.create({
      data: {
        id: SEED_USER_ID,
        email: SEED_USER_EMAIL,
        username,
        firstName: "Perf",
        lastName: "Tester",
        onboarded: true,
        // Bookings & multi-workspace are premium-gated; keep the perf user
        // out of paywalls regardless of ENABLE_PREMIUM_FEATURES.
        tier: { connect: { id: "tier_2" } },
        skipSubscriptionCheck: true,
        // Master-data Role rows are inserted by migration
        // 20240422181938_create_default_user_roles.
        roles: { connect: { name: "USER" } },
      },
    });

    /* ---------------------------------------------------------- */
    /* 2. Organization + default org rows                         */
    /* ---------------------------------------------------------- */
    console.log("2/12 Creating TEAM organization with default org rows...");
    const customFieldPlans = buildCustomFieldPlans();
    const indexColumns = [
      ...DEFAULT_INDEX_COLUMNS,
      ...customFieldPlans.map((cf, i) => ({
        name: `cf_${cf.name}`,
        visible: true,
        position: DEFAULT_INDEX_COLUMNS.length + i,
        cfType: cf.type,
      })),
    ];

    // Mirrors createOrganization() in app/modules/organization/service.server.ts
    const org = await db.organization.create({
      data: {
        name: "Perf Test Org",
        type: "TEAM",
        currency: "USD",
        hasSequentialIdsMigrated: true,
        owner: { connect: { id: SEED_USER_ID } },
        userOrganizations: {
          create: { userId: SEED_USER_ID, roles: ["OWNER"] },
        },
        members: {
          create: {
            name: "Perf Tester (Owner)",
            user: { connect: { id: SEED_USER_ID } },
          },
        },
        assetIndexSettings: {
          create: {
            mode: "ADVANCED",
            columns: indexColumns,
            user: { connect: { id: SEED_USER_ID } },
          },
        },
        workingHours: {
          // weeklySchedule falls back to the schema default (Mon-Fri 9-5)
          create: { enabled: false },
        },
        bookingSettings: {
          create: { bufferStartTime: 0 },
        },
      },
      select: { id: true },
    });
    const orgId = org.id;

    const ownerTeamMember = await db.teamMember.findFirstOrThrow({
      where: { organizationId: orgId, userId: SEED_USER_ID },
      select: { id: true },
    });

    /* ---------------------------------------------------------- */
    /* 3. Taxonomy: categories, tags, locations, custom fields    */
    /* ---------------------------------------------------------- */
    console.log("3/12 Creating taxonomy (categories, tags, locations, custom fields)...");

    const categoryIds: string[] = [];
    const categoryRows: Prisma.CategoryCreateManyInput[] = [];
    for (let i = 0; i < TARGETS.categories; i++) {
      const id = pid();
      categoryIds.push(id);
      categoryRows.push({
        id,
        name: `${pick(ADJECTIVES)} ${pick(NOUNS)}s ${i + 1}`,
        description: `Perf category #${i + 1}`,
        color: `#${randInt(0, 0xffffff).toString(16).padStart(6, "0")}`,
        userId: SEED_USER_ID,
        organizationId: orgId,
      });
    }
    await db.category.createMany({ data: categoryRows });

    const tagIds: string[] = [];
    const tagRows: Prisma.TagCreateManyInput[] = [];
    for (let i = 0; i < TARGETS.tags; i++) {
      const id = pid();
      tagIds.push(id);
      tagRows.push({
        id,
        name: `perf-tag-${String(i + 1).padStart(2, "0")}-${pick(NOUNS).toLowerCase().replace(/\s+/g, "-")}`,
        color: `#${randInt(0, 0xffffff).toString(16).padStart(6, "0")}`,
        userId: SEED_USER_ID,
        organizationId: orgId,
      });
    }
    await db.tag.createMany({ data: tagRows });

    const locationIds: string[] = [];
    const locationRows: Prisma.LocationCreateManyInput[] = [];
    for (let i = 0; i < TARGETS.locations; i++) {
      const id = pid();
      locationIds.push(id);
      locationRows.push({
        id,
        name: `Warehouse ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1} - ${pick(NOUNS)} storage`,
        description: `Perf location #${i + 1}`,
        address: `${randInt(1, 999)} ${pick(LAST_NAMES)} Street, Springfield`,
        userId: SEED_USER_ID,
        organizationId: orgId,
      });
    }
    await db.location.createMany({ data: locationRows });

    await db.customField.createMany({
      data: customFieldPlans.map((cf) => ({
        id: cf.id,
        name: cf.name,
        helpText: `Perf custom field (${cf.type})`,
        type: cf.type,
        options: cf.options,
        required: false,
        active: true,
        userId: SEED_USER_ID,
        organizationId: orgId,
      })),
    });
    console.log(
      `  ${TARGETS.categories} categories, ${TARGETS.tags} tags, ` +
        `${TARGETS.locations} locations, ${TARGETS.customFields} custom fields`
    );

    /* ---------------------------------------------------------- */
    /* 4. Team members                                            */
    /* ---------------------------------------------------------- */
    console.log("4/12 Creating team members...");
    const teamMemberIds: string[] = [ownerTeamMember.id];
    const teamMemberRows: Prisma.TeamMemberCreateManyInput[] = [];
    for (let i = 0; i < TARGETS.nonRegisteredTeamMembers; i++) {
      const id = pid();
      teamMemberIds.push(id);
      teamMemberRows.push({
        id,
        name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
        organizationId: orgId,
        userId: null,
      });
    }
    await db.teamMember.createMany({ data: teamMemberRows });
    console.log(`  ${teamMemberIds.length} team members (incl. owner)`);

    /* ---------------------------------------------------------- */
    /* 5. Kits                                                    */
    /* ---------------------------------------------------------- */
    console.log("5/12 Creating kits...");
    const kitIds: string[] = [];
    const kitRows: Prisma.KitCreateManyInput[] = [];
    for (let i = 0; i < TARGETS.kits; i++) {
      const id = pid();
      kitIds.push(id);
      kitRows.push({
        id,
        name: `Kit ${String(i + 1).padStart(3, "0")} - ${pick(ADJECTIVES)} ${pick(NOUNS)} set`,
        description: `Perf kit #${i + 1}`,
        status: "AVAILABLE",
        organizationId: orgId,
        createdById: SEED_USER_ID,
        categoryId: chance(0.5) ? pick(categoryIds) : null,
        // locationId intentionally left null: kit locations would require
        // kit-driven AssetLocation rows to stay app-consistent.
      });
    }
    await db.kit.createMany({ data: kitRows });
    console.log(`  ${kitIds.length} kits`);

    /* ---------------------------------------------------------- */
    /* 6. Assets + Qr codes + pivots + custom field values + tags */
    /* ---------------------------------------------------------- */
    console.log("6/12 Creating assets (+Qr, kit/location pivots, custom field values, tags)...");

    type AssetPlan = {
      id: string;
      isQuantityTracked: boolean;
      quantity: number | null;
      inKit: boolean;
    };

    const assetPlans: AssetPlan[] = [];
    const assetRows: Prisma.AssetCreateManyInput[] = [];
    const qrRows: Prisma.QrCreateManyInput[] = [];
    const assetKitRows: Prisma.AssetKitCreateManyInput[] = [];
    const assetLocationRows: Prisma.AssetLocationCreateManyInput[] = [];
    const cfValueRows: Prisma.AssetCustomFieldValueCreateManyInput[] = [];
    const tagPairs: Array<[assetId: string, tagId: string]> = [];
    const qrIds: string[] = [];

    const assetCreatedStart = daysFromNow(-365);
    const assetCreatedEnd = daysFromNow(-1);

    for (let i = 0; i < TARGETS.assets; i++) {
      const id = pid();
      const isQuantityTracked = chance(FRACTIONS.quantityTracked);
      const quantity = isQuantityTracked ? randInt(5, 100) : null;
      const inKit = chance(FRACTIONS.inKit);
      assetPlans.push({ id, isQuantityTracked, quantity, inKit });

      const seq = `SAM-${String(i + 1).padStart(4, "0")}`;
      assetRows.push({
        id,
        title: `${pick(BRANDS)} ${pick(ADJECTIVES)} ${pick(NOUNS)} ${seq}`,
        description: chance(0.8)
          ? `Perf asset ${seq}. ${pick(NOTE_SNIPPETS)}`
          : null,
        status: "AVAILABLE", // custody / checkout statuses applied later
        valuation: chance(0.7) ? randInt(25, 8000) : null,
        availableToBook: chance(0.92),
        sequentialId: seq,
        type: isQuantityTracked ? "QUANTITY_TRACKED" : "INDIVIDUAL",
        quantity,
        minQuantity: isQuantityTracked && chance(0.5) ? randInt(1, 5) : null,
        consumptionType: isQuantityTracked
          ? chance(0.7)
            ? "TWO_WAY"
            : "ONE_WAY"
          : null,
        unitOfMeasure: isQuantityTracked
          ? pick(["pcs", "boxes", "liters", "meters"])
          : null,
        createdAt: randomDate(assetCreatedStart, assetCreatedEnd),
        userId: SEED_USER_ID,
        organizationId: orgId,
        categoryId: chance(FRACTIONS.withCategory) ? pick(categoryIds) : null,
      });

      // One Qr per asset (mirrors app-side QR creation: version 0, EC "L").
      const qrId = pid();
      qrIds.push(qrId);
      qrRows.push({
        id: qrId,
        version: 0,
        errorCorrection: "L",
        assetId: id,
        userId: SEED_USER_ID,
        organizationId: orgId,
      });

      // Kit membership via AssetKit pivot. INDIVIDUAL assets: one kit max,
      // quantity 1 (DB trigger enforced). QUANTITY_TRACKED: single kit row
      // with quantity <= Asset.quantity (deferred sum trigger).
      if (inKit) {
        assetKitRows.push({
          id: pid(),
          assetId: id,
          kitId: pick(kitIds),
          organizationId: orgId,
          quantity: isQuantityTracked
            ? randInt(1, Math.min(quantity as number, 5))
            : 1,
        });
      }

      // Location via AssetLocation pivot (no Asset.locationId FK exists).
      if (chance(FRACTIONS.withLocation)) {
        assetLocationRows.push({
          id: pid(),
          assetId: id,
          locationId: pick(locationIds),
          organizationId: orgId,
          quantity: isQuantityTracked ? randInt(1, quantity as number) : 1,
        });
      }

      // 2-4 custom field values for ~60% of assets.
      if (chance(FRACTIONS.withCustomFieldValues)) {
        const fields = pickN(customFieldPlans, randInt(2, 4));
        for (const cf of fields) {
          cfValueRows.push({
            id: pid(),
            value: buildCfValue(cf),
            assetId: id,
            customFieldId: cf.id,
          });
        }
      }

      // 1-3 tags for ~50% of assets (implicit m2m, raw insert below).
      if (chance(FRACTIONS.withTags)) {
        for (const tagId of pickN(tagIds, randInt(1, 3))) {
          tagPairs.push([id, tagId]);
        }
      }
    }

    await batchedCreateMany(
      assetRows,
      (chunk) => db.asset.createMany({ data: chunk }),
      "assets"
    );
    await batchedCreateMany(
      qrRows,
      (chunk) => db.qr.createMany({ data: chunk }),
      "qr codes"
    );
    await batchedCreateMany(
      assetKitRows,
      (chunk) => db.assetKit.createMany({ data: chunk }),
      "asset-kit pivots"
    );
    await batchedCreateMany(
      assetLocationRows,
      (chunk) => db.assetLocation.createMany({ data: chunk }),
      "asset-location pivots"
    );
    await batchedCreateMany(
      cfValueRows,
      (chunk) => db.assetCustomFieldValue.createMany({ data: chunk }),
      "custom field values"
    );

    // Implicit m2m Asset<->Tag: insert into "_AssetToTag" ("A"=assetId,
    // "B"=tagId) directly; createMany can't touch implicit join tables.
    for (let i = 0; i < tagPairs.length; i += BATCH_SIZE) {
      const chunk = tagPairs.slice(i, i + BATCH_SIZE);
      await db.$executeRaw(
        Prisma.sql`INSERT INTO "_AssetToTag" ("A", "B") VALUES ${Prisma.join(
          chunk.map(([a, b]) => Prisma.sql`(${a}, ${b})`)
        )} ON CONFLICT DO NOTHING`
      );
      process.stdout.write(
        `\r  asset-tag links: ${Math.min(i + BATCH_SIZE, tagPairs.length)}/${tagPairs.length}`
      );
    }
    process.stdout.write("\n");

    // Advance the org's sequential-id sequence past our SAM-XXXX values so
    // app-side asset creation doesn't collide (function shipped in migration
    // 20250818111341_add_sequential_id_sequences).
    await db.$executeRaw`SELECT reset_asset_sequence_for_org(${orgId})`;

    /* ---------------------------------------------------------- */
    /* 7. Custody                                                 */
    /* ---------------------------------------------------------- */
    console.log("7/12 Creating custody rows...");
    // Only INDIVIDUAL assets outside kits: keeps the single-custody DB
    // trigger and kit-custody semantics trivially satisfied.
    const custodyEligible = assetPlans
      .filter((a) => !a.isQuantityTracked && !a.inKit)
      .map((a) => a.id);
    const custodyAssetIds = pickN(custodyEligible, TARGETS.custodies);
    const custodyRows: Prisma.CustodyCreateManyInput[] = custodyAssetIds.map(
      (assetId) => ({
        id: pid(),
        assetId,
        teamMemberId: pick(teamMemberIds),
        quantity: 1,
      })
    );
    await batchedCreateMany(
      custodyRows,
      (chunk) => db.custody.createMany({ data: chunk }),
      "custodies"
    );
    await db.asset.updateMany({
      where: { id: { in: custodyAssetIds }, organizationId: orgId },
      data: { status: "IN_CUSTODY" },
    });
    console.log(`  ${custodyAssetIds.length} assets set to IN_CUSTODY`);

    /* ---------------------------------------------------------- */
    /* 8. Bookings + BookingAsset pivots                          */
    /* ---------------------------------------------------------- */
    console.log("8/12 Creating bookings...");
    const inCustody = new Set(custodyAssetIds);
    const bookableAssetIds = assetPlans
      .filter((a) => !inCustody.has(a.id))
      .map((a) => a.id);
    const qtQuantityByAsset = new Map<string, number>(
      assetPlans
        .filter((a) => a.isQuantityTracked)
        .map((a) => [a.id, a.quantity as number])
    );

    const bookingRows: Prisma.BookingCreateManyInput[] = [];
    const bookingAssetRows: Prisma.BookingAssetCreateManyInput[] = [];
    const checkedOutAssetIds = new Set<string>();

    let bookingNo = 0;
    for (const { status, count } of BOOKING_STATUS_PLAN) {
      for (let i = 0; i < count; i++) {
        bookingNo += 1;
        const bookingId = pid();

        // Date windows per status, spread across -6..+6 months.
        let from: Date;
        let to: Date;
        switch (status) {
          case "COMPLETE":
          case "ARCHIVED": {
            from = randomDate(daysFromNow(-180), daysFromNow(-20));
            to = new Date(from.getTime() + randInt(1, 14) * DAY_MS);
            break;
          }
          case "ONGOING": {
            from = randomDate(daysFromNow(-10), daysFromNow(-1));
            to = randomDate(daysFromNow(1), daysFromNow(10));
            break;
          }
          case "OVERDUE": {
            from = randomDate(daysFromNow(-30), daysFromNow(-12));
            to = randomDate(daysFromNow(-9), daysFromNow(-1));
            break;
          }
          case "RESERVED": {
            from = randomDate(daysFromNow(2), daysFromNow(180));
            to = new Date(from.getTime() + randInt(1, 14) * DAY_MS);
            break;
          }
          default: {
            // DRAFT / CANCELLED: anywhere in the window
            from = randomDate(daysFromNow(-60), daysFromNow(180));
            to = new Date(from.getTime() + randInt(1, 14) * DAY_MS);
            break;
          }
        }

        const custodianTeamMemberId = pick(teamMemberIds);
        bookingRows.push({
          id: bookingId,
          name: `PERF Booking #${String(bookingNo).padStart(3, "0")} - ${pick(NOUNS)} job`,
          status,
          description: chance(0.5) ? `Seeded ${status} booking for perf tests.` : "",
          creatorId: SEED_USER_ID,
          custodianTeamMemberId,
          // Only the owner's TeamMember maps to a registered user.
          custodianUserId:
            custodianTeamMemberId === ownerTeamMember.id ? SEED_USER_ID : null,
          organizationId: orgId,
          from,
          to,
          createdAt: new Date(
            Math.min(from.getTime() - randInt(1, 20) * DAY_MS, Date.now())
          ),
          cancellationReason:
            status === "CANCELLED" && chance(0.7)
              ? "Cancelled during perf seeding"
              : null,
          archivedWithoutCheckin: false,
        });

        // 5-40 distinct assets per booking (standalone rows, assetKitId null;
        // partial unique (bookingId, assetId) WHERE assetKitId IS NULL holds
        // because pickN never repeats within a booking).
        const linkedAssets = pickN(bookableAssetIds, randInt(5, 40));
        for (const assetId of linkedAssets) {
          const qtTotal = qtQuantityByAsset.get(assetId);
          bookingAssetRows.push({
            id: pid(),
            bookingId,
            assetId,
            quantity: qtTotal ? randInt(1, Math.min(qtTotal, 3)) : 1,
          });
          if (status === "ONGOING" || status === "OVERDUE") {
            // Only INDIVIDUAL assets flip to CHECKED_OUT; QT assets keep
            // per-slice availability semantics.
            if (!qtTotal) checkedOutAssetIds.add(assetId);
          }
        }
      }
    }

    await batchedCreateMany(
      bookingRows,
      (chunk) => db.booking.createMany({ data: chunk }),
      "bookings"
    );
    await batchedCreateMany(
      bookingAssetRows,
      (chunk) => db.bookingAsset.createMany({ data: chunk }),
      "booking-asset pivots"
    );

    // Assets on ONGOING/OVERDUE bookings go CHECKED_OUT (unless in custody).
    const checkedOutList = [...checkedOutAssetIds];
    for (let i = 0; i < checkedOutList.length; i += BATCH_SIZE) {
      await db.asset.updateMany({
        where: {
          id: { in: checkedOutList.slice(i, i + BATCH_SIZE) },
          organizationId: orgId,
          status: "AVAILABLE",
        },
        data: { status: "CHECKED_OUT" },
      });
    }
    console.log(
      `  ${bookingRows.length} bookings, ${bookingAssetRows.length} booking-asset links, ` +
        `${checkedOutList.length} assets flagged CHECKED_OUT`
    );

    /* ---------------------------------------------------------- */
    /* 9. Notes                                                   */
    /* ---------------------------------------------------------- */
    console.log("9/12 Creating notes...");
    const allAssetIds = assetPlans.map((a) => a.id);
    const noteRows: Prisma.NoteCreateManyInput[] = [];
    for (let i = 0; i < TARGETS.notes; i++) {
      const isUpdate = chance(0.3);
      noteRows.push({
        id: pid(),
        content: isUpdate
          ? `**Perf Tester** ${pick([
              "updated the asset",
              "changed the location",
              "assigned custody",
              "checked the asset in",
            ])}.`
          : pick(NOTE_SNIPPETS),
        type: isUpdate ? "UPDATE" : "COMMENT",
        userId: SEED_USER_ID,
        assetId: pick(allAssetIds),
        createdAt: randomDate(daysFromNow(-180), new Date()),
      });
    }
    await batchedCreateMany(
      noteRows,
      (chunk) => db.note.createMany({ data: chunk }),
      "notes"
    );

    /* ---------------------------------------------------------- */
    /* 10. Scans                                                  */
    /* ---------------------------------------------------------- */
    console.log("10/12 Creating scans...");
    const scanRows: Prisma.ScanCreateManyInput[] = [];
    for (let i = 0; i < TARGETS.scans; i++) {
      const qrId = pick(qrIds);
      const withCoords = chance(0.3);
      scanRows.push({
        id: pid(),
        rawQrId: qrId, // raw string copy kept even if the Qr row is deleted
        qrId,
        userId: chance(0.6) ? SEED_USER_ID : null,
        userAgent: pick(USER_AGENTS),
        latitude: withCoords ? (48 + rng() * 5).toFixed(6) : null,
        longitude: withCoords ? (2 + rng() * 10).toFixed(6) : null,
        manuallyGenerated: chance(0.1),
        createdAt: randomDate(daysFromNow(-180), new Date()),
      });
    }
    await batchedCreateMany(
      scanRows,
      (chunk) => db.scan.createMany({ data: chunk }),
      "scans"
    );

    /* ---------------------------------------------------------- */
    /* 11. Sanity counts                                          */
    /* ---------------------------------------------------------- */
    console.log("11/12 Verifying row counts...");
    const [
      users,
      orgs,
      categories,
      tags,
      locations,
      customFields,
      teamMembers,
      kits,
      assets,
      qrs,
      assetKits,
      assetLocations,
      cfValues,
      custodies,
      bookings,
      bookingAssets,
      notes,
      scans,
    ] = await Promise.all([
      db.user.count(),
      db.organization.count(),
      db.category.count({ where: { organizationId: orgId } }),
      db.tag.count({ where: { organizationId: orgId } }),
      db.location.count({ where: { organizationId: orgId } }),
      db.customField.count({ where: { organizationId: orgId, deletedAt: null } }),
      db.teamMember.count({ where: { organizationId: orgId } }),
      db.kit.count({ where: { organizationId: orgId } }),
      db.asset.count({ where: { organizationId: orgId } }),
      db.qr.count({ where: { organizationId: orgId } }),
      db.assetKit.count({ where: { organizationId: orgId } }),
      db.assetLocation.count({ where: { organizationId: orgId } }),
      db.assetCustomFieldValue.count(),
      db.custody.count(),
      db.booking.count({ where: { organizationId: orgId } }),
      db.bookingAsset.count(),
      db.note.count(),
      db.scan.count(),
    ]);

    /* ---------------------------------------------------------- */
    /* 12. Summary                                                */
    /* ---------------------------------------------------------- */
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`12/12 Done in ${secs}s.\n`);
    console.log("=== Seed summary (rows in DB) ===");
    const summary: Array<[string, number]> = [
      ["users", users],
      ["organizations", orgs],
      ["categories", categories],
      ["tags", tags],
      ["locations", locations],
      ["customFields", customFields],
      ["teamMembers", teamMembers],
      ["kits", kits],
      ["assets", assets],
      ["qrCodes", qrs],
      ["assetKit pivots", assetKits],
      ["assetLocation pivots", assetLocations],
      ["customFieldValues", cfValues],
      ["custodies", custodies],
      ["bookings", bookings],
      ["bookingAsset pivots", bookingAssets],
      ["notes", notes],
      ["scans", scans],
    ];
    for (const [label, value] of summary) {
      console.log(`  ${label.padEnd(22)} ${value}`);
    }
    console.log(`\nOrganization id: ${orgId}`);
    console.log(`Owner user id:   ${SEED_USER_ID}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(
    "\nPerf seeder failed:\n",
    err instanceof Error ? err.stack ?? err.message : err,
    "\n"
  );
  process.exit(1);
});
