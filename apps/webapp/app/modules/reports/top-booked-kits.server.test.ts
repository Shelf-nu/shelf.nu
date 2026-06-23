/**
 * Top Booked Kits Report — Aggregation Tests
 *
 * Covers the public `topBookedKitsReport` function: that kits are counted
 * once per booking (kits are atomic in a booking), aggregated across
 * bookings, ranked by booking volume, and summarised into KPIs whose
 * "total" reconciles with the per-kit booking counts.
 *
 * @see {@link file://./helpers.server.ts}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// why: Mock the Prisma client so the unit tests never touch a real database.
// Matches the pattern in `helpers.server.test.ts`. `kit.update` is stubbed
// for `refreshExpiredKitImages`, which only calls it for expired image URLs —
// these tests use kits with no image, so it is never actually invoked.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vi.fn(),
    },
    kit: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "~/database/db.server";

import { topBookedKitsReport } from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-04-01T00:00:00Z"),
  to: new Date("2026-04-30T23:59:59Z"),
};

/** Build a kit-metadata row as returned by the hydration `db.kit.findMany`. */
function kitMeta(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    organizationId: "org-1",
    name,
    image: null,
    imageExpiration: null,
    category: null,
    location: null,
    ...overrides,
  };
}

/**
 * Build a booking row as returned by the lightweight scan
 * `db.booking.findMany`. Post-Phase-4a: Booking has no direct `assets`
 * relation; assets live behind the `BookingAsset` pivot, and kit
 * membership is on the `AssetKit` pivot (asset.kitId was removed). A
 * non-null `kitId` here translates to one `assetKits` entry on the
 * projected asset; a null `kitId` translates to an empty `assetKits[]`
 * (a standalone asset that's not in any kit, which the report should
 * ignore).
 */
function booking(from: string, to: string, kitIds: Array<string | null>) {
  return {
    from: new Date(from),
    to: new Date(to),
    bookingAssets: kitIds.map((kitId, i) => ({
      asset: {
        id: `asset-${i}-${kitId}`,
        assetKits: kitId ? [{ kitId }] : [],
      },
    })),
  };
}

describe("topBookedKitsReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.booking.findMany).mockResolvedValue([] as any);
    vi.mocked(db.kit.findMany).mockResolvedValue([] as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a kit once per booking even when multiple of its assets are present", async () => {
    // A single booking containing three assets that all belong to kit-1.
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking("2026-04-10T00:00:00Z", "2026-04-12T00:00:00Z", [
        "kit-1",
        "kit-1",
        "kit-1",
      ]),
    ] as any);
    vi.mocked(db.kit.findMany).mockResolvedValue([
      kitMeta("kit-1", "Camera Kit"),
    ] as any);

    const result = await topBookedKitsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    // Deduped per booking: 1, not 3.
    expect(result.rows[0].bookingCount).toBe(1);
    // Booking spans 2 days.
    expect(result.rows[0].totalDaysBooked).toBe(2);
  });

  it("aggregates booking count and total days across multiple bookings", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking("2026-04-10T00:00:00Z", "2026-04-12T00:00:00Z", ["kit-1"]), // 2 days
      booking("2026-04-20T00:00:00Z", "2026-04-23T00:00:00Z", ["kit-1"]), // 3 days
    ] as any);
    vi.mocked(db.kit.findMany).mockResolvedValue([
      kitMeta("kit-1", "Camera Kit"),
    ] as any);

    const result = await topBookedKitsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].bookingCount).toBe(2);
    expect(result.rows[0].totalDaysBooked).toBe(5);
  });

  it("ranks kits by booking volume and exposes the #1 as topBookedKit", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking("2026-04-05T00:00:00Z", "2026-04-06T00:00:00Z", ["kit-1"]),
      booking("2026-04-10T00:00:00Z", "2026-04-11T00:00:00Z", [
        "kit-1",
        "kit-2",
      ]),
    ] as any);
    vi.mocked(db.kit.findMany).mockResolvedValue([
      kitMeta("kit-1", "Camera Kit"),
      kitMeta("kit-2", "Lighting Kit"),
    ] as any);

    const result = await topBookedKitsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows.map((r) => r.kitId)).toEqual(["kit-1", "kit-2"]);
    expect(result.rows[0].bookingCount).toBe(2);
    expect(result.rows[1].bookingCount).toBe(1);
    expect(result.topBookedKit?.kitId).toBe("kit-1");
    expect(result.topBookedKit?.bookingCount).toBe(2);
  });

  it("builds KPIs whose total reconciles with the per-kit counts", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking("2026-04-05T00:00:00Z", "2026-04-06T00:00:00Z", ["kit-1"]),
      booking("2026-04-10T00:00:00Z", "2026-04-11T00:00:00Z", [
        "kit-1",
        "kit-2",
      ]),
    ] as any);
    vi.mocked(db.kit.findMany).mockResolvedValue([
      kitMeta("kit-1", "Camera Kit"),
      kitMeta("kit-2", "Lighting Kit"),
    ] as any);

    const result = await topBookedKitsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const byId = (id: string) => result.kpis.find((k) => k.id === id)?.rawValue;
    // Sum of per-kit booking counts: kit-1 (2) + kit-2 (1) = 3.
    expect(byId("total_kit_bookings")).toBe(3);
    expect(byId("unique_kits_booked")).toBe(2);
    expect(byId("avg_bookings_per_kit")).toBe(1.5);
  });

  it("ignores assets with no kit and returns an empty report when no kits are booked", async () => {
    vi.mocked(db.booking.findMany).mockResolvedValue([
      booking("2026-04-10T00:00:00Z", "2026-04-12T00:00:00Z", [null, null]),
    ] as any);

    const result = await topBookedKitsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(result.rows).toHaveLength(0);
    expect(result.totalRows).toBe(0);
    expect(result.topBookedKit).toBeNull();
    // No kit ids to hydrate → the kit query is skipped entirely.
    expect(db.kit.findMany).not.toHaveBeenCalled();
  });

  it("scopes the booking scan to the org and excludes DRAFT/CANCELLED bookings", async () => {
    await topBookedKitsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    expect(db.booking.findMany).toHaveBeenCalledTimes(1);
    const where = vi.mocked(db.booking.findMany).mock.calls[0][0]?.where as any;
    expect(where.organizationId).toBe("org-1");
    expect(where.status).toEqual({ notIn: ["DRAFT", "CANCELLED"] });
  });

  it("uses an interval-overlap timeframe predicate (counts bookings spanning the window)", async () => {
    await topBookedKitsReport({
      organizationId: "org-1",
      timeframe: TIMEFRAME,
    });

    const where = vi.mocked(db.booking.findMany).mock.calls[0][0]?.where as any;
    // Overlap = starts on/before window end AND ends on/after window start.
    // A naive start-OR-end-in-window test (where.OR) would miss bookings that
    // span the entire window, so assert we are NOT using it.
    expect(where.from).toEqual({ lte: TIMEFRAME.to });
    expect(where.to).toEqual({ gte: TIMEFRAME.from });
    expect(where.OR).toBeUndefined();
  });
});
