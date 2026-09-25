// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_DB_AVAILABLE, getFixtureDb } from "@tooling/fixture-db";
import {
  fetchBarcodesBatch,
  fetchBookingsBatch,
  fetchCustodyBatch,
} from "./hydrate-heavy.server";
import type { BatchArgs, BookingLite, CustodyLite } from "./types";

/**
 * Two layers of coverage, matching `hydrate-simple.server.test.ts`:
 *
 * 1. Mocked unit tests (below): assert grouping, empty-omission, and
 *    redaction against a mocked `db.$queryRaw`/`db.barcode.findMany` — no
 *    database required. The mock returns whatever shape the test hands it,
 *    so these tests cover this module's JS logic (grouping into a
 *    `BatchMap`, applying redaction) but cannot catch a wrong column name or
 *    a dropped `@map` in the raw SQL itself — raw SQL is opaque to both the
 *    type-checker and a mock.
 * 2. Real-DB smokes (bottom of the file): the same batches against a real,
 *    read-only fixture database, skipped automatically when
 *    `FIXTURE_DATABASE_URL` isn't configured. For `fetchCustodyBatch` and
 *    `fetchBookingsBatch` these are the ONLY check in the repo that can
 *    catch a raw-SQL column/`@map` mistake.
 */

type MockDb = {
  $queryRaw: ReturnType<typeof vi.fn>;
  barcode: { findMany: ReturnType<typeof vi.fn> };
};

const dbMock = vi.hoisted<MockDb>(() => ({
  $queryRaw: vi.fn(),
  barcode: { findMany: vi.fn() },
}));

// why: isolating the batch queries from a real database for unit testing —
// each test controls exactly what rows the (mocked) query returns, which lets
// grouping/redaction be asserted deterministically. `withPrismaRetry` is left
// real (not mocked): on a resolving mock it just awaits and returns the
// operation's result once, with no retry side effects to guard against.
vi.mock("~/database/db.server", () => ({ db: dbMock }));

const ORG_ID = "org-1";

/** Base `BatchArgs` shared by every test; individual tests override fields. */
function makeArgs(overrides: Partial<BatchArgs> = {}): BatchArgs {
  return {
    ids: ["asset-1", "asset-2"],
    organizationId: ORG_ID,
    viewerScope: { userId: "user-1", canSeeAllCustody: true },
    barcodesEnabled: false,
    ...overrides,
  };
}

/** One custody entry, shaped exactly as the raw query's `jsonb_build_object` emits it. */
function makeCustodyEntry(overrides: Partial<CustodyLite> = {}): CustodyLite {
  return {
    name: "Jane Doe",
    quantity: 1,
    custodian: {
      name: "Jane Doe",
      user: {
        id: "user-jane",
        firstName: "Jane",
        lastName: "Doe",
        displayName: null,
        profilePicture: null,
      },
    },
    ...overrides,
  };
}

/** One booking-slice entry, shaped exactly as the raw query's `jsonb_build_object` emits it. */
function makeBookingEntry(overrides: Partial<BookingLite> = {}): BookingLite {
  return {
    id: "booking-1",
    name: "Weekend Shoot",
    description: null,
    status: "RESERVED",
    from: "2026-09-01T10:00:00+00:00",
    to: "2026-09-02T10:00:00+00:00",
    tags: [{ id: "tag-1", name: "Outdoor" }],
    custodianTeamMember: null,
    custodianUser: null,
    creator: {
      id: "creator-1",
      firstName: "Creator",
      lastName: "Person",
      displayName: null,
      profilePicture: null,
    },
    assetKitId: null,
    quantity: 1,
    kitName: null,
    ...overrides,
  };
}

beforeEach(() => {
  dbMock.$queryRaw.mockReset();
  dbMock.barcode.findMany.mockReset();
});

describe("fetchCustodyBatch", () => {
  it("groups a has-custody asset's rows into CustodyLite[]", async () => {
    const entry = makeCustodyEntry();
    dbMock.$queryRaw.mockResolvedValue([
      { assetId: "asset-1", custody: [entry] },
    ]);

    const map = await fetchCustodyBatch(makeArgs());

    expect(map.get("asset-1")).toEqual([entry]);
  });

  it("omits an asset the query returns with null custody (the CASE's ELSE NULL)", async () => {
    // The query is asset-driven, so it CAN return a row for an asset that
    // holds nobody — with custody null (neither direct nor booking-derived).
    // That asset must be omitted so the assembler applies its null default,
    // not stored as an empty array.
    dbMock.$queryRaw.mockResolvedValue([
      { assetId: "asset-1", custody: [makeCustodyEntry()] },
      { assetId: "asset-2", custody: null },
    ]);

    const map = await fetchCustodyBatch(makeArgs());

    expect(map.has("asset-1")).toBe(true);
    expect(map.has("asset-2")).toBe(false);
  });

  it("groups and redacts a booking-derived custodian (no quantity) like a direct one", async () => {
    // The booking-derived branch emits the same CustodyLite shape as a direct
    // row but without `quantity`; redaction is shape-based, so a restricted
    // viewer who is not the borrower gets it blanked all the same.
    const derived = makeCustodyEntry({
      name: "Borrower Person",
      quantity: undefined,
      custodian: {
        name: "Borrower Person",
        user: {
          id: "borrower",
          firstName: "Borrower",
          lastName: "Person",
          displayName: null,
          profilePicture: null,
        },
      },
    });
    dbMock.$queryRaw.mockResolvedValue([
      { assetId: "asset-1", custody: [derived] },
    ]);

    const map = await fetchCustodyBatch(
      makeArgs({ viewerScope: { userId: "user-1", canSeeAllCustody: false } })
    );

    const [entry] = map.get("asset-1")!;
    expect(entry.custodian.name).toBe("");
    expect(entry.custodian.user).toBeNull();
    expect(JSON.stringify(entry)).not.toContain("Borrower");
  });

  it("redacts a colleague's custodian for a restricted viewer while keeping the viewer's own", async () => {
    const colleague = makeCustodyEntry({
      name: "Colleague Name",
      custodian: {
        name: "Colleague Name",
        user: {
          id: "someone-else",
          firstName: "Colleague",
          lastName: "Person",
          displayName: null,
          profilePicture: null,
        },
      },
    });
    const ownEntry = makeCustodyEntry({
      name: "Me Myself",
      custodian: {
        name: "Me Myself",
        user: {
          id: "user-1",
          firstName: "Me",
          lastName: "Self",
          displayName: null,
          profilePicture: null,
        },
      },
    });
    dbMock.$queryRaw.mockResolvedValue([
      { assetId: "asset-1", custody: [colleague, ownEntry] },
    ]);

    const map = await fetchCustodyBatch(
      makeArgs({
        viewerScope: { userId: "user-1", canSeeAllCustody: false },
      })
    );

    const [redactedColleague, ownUntouched] = map.get("asset-1")!;
    expect(redactedColleague.name).toBe("");
    expect(redactedColleague.custodian.name).toBe("");
    expect(redactedColleague.custodian.user).toBeNull();
    expect(JSON.stringify(redactedColleague)).not.toContain("Colleague");
    // The viewer's own custody survives untouched.
    expect(ownUntouched).toEqual(ownEntry);
  });

  it("applies no redaction when the viewer can see all custody", async () => {
    const colleague = makeCustodyEntry({ name: "Colleague Name" });
    dbMock.$queryRaw.mockResolvedValue([
      { assetId: "asset-1", custody: [colleague] },
    ]);

    const map = await fetchCustodyBatch(
      makeArgs({
        viewerScope: { userId: "user-1", canSeeAllCustody: true },
      })
    );

    expect(map.get("asset-1")).toEqual([colleague]);
  });
});

describe("fetchBookingsBatch", () => {
  it("returns one entry per BookingAsset slice, not one per booking", async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        assetId: "asset-1",
        booking: makeBookingEntry({ assetKitId: null }),
      },
      {
        assetId: "asset-1",
        booking: makeBookingEntry({
          assetKitId: "asset-kit-1",
          kitName: "Camera Kit",
        }),
      },
    ]);

    const map = await fetchBookingsBatch(makeArgs());

    expect(map.get("asset-1")).toHaveLength(2);
  });

  it("omits an asset with no active/upcoming booking rather than storing []", async () => {
    dbMock.$queryRaw.mockResolvedValue([
      { assetId: "asset-1", booking: makeBookingEntry() },
    ]);

    const map = await fetchBookingsBatch(makeArgs());

    expect(map.has("asset-2")).toBe(false);
  });

  it("keeps from/to as strings, never wrapping them", async () => {
    dbMock.$queryRaw.mockResolvedValue([
      { assetId: "asset-1", booking: makeBookingEntry() },
    ]);

    const map = await fetchBookingsBatch(makeArgs());

    const [booking] = map.get("asset-1")!;
    expect(typeof booking.from).toBe("string");
    expect(typeof booking.to).toBe("string");
  });

  it("redacts custodianTeamMember/custodianUser for a restricted viewer, never the creator", async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        assetId: "asset-1",
        booking: makeBookingEntry({
          custodianUser: {
            id: "someone-else",
            firstName: "Colleague",
            lastName: "Person",
            displayName: null,
            profilePicture: null,
          },
        }),
      },
    ]);

    const map = await fetchBookingsBatch(
      makeArgs({
        viewerScope: { userId: "user-1", canSeeAllCustody: false },
      })
    );

    const [booking] = map.get("asset-1")!;
    expect(booking.custodianUser).toBeNull();
    expect(booking.creator?.firstName).toBe("Creator");
    expect(JSON.stringify(booking)).not.toContain("someone-else");
  });

  it("leaves custodian fields untouched when the viewer can see all custody", async () => {
    dbMock.$queryRaw.mockResolvedValue([
      {
        assetId: "asset-1",
        booking: makeBookingEntry({
          custodianUser: {
            id: "someone-else",
            firstName: "Colleague",
            lastName: "Person",
            displayName: null,
            profilePicture: null,
          },
        }),
      },
    ]);

    const map = await fetchBookingsBatch(
      makeArgs({
        viewerScope: { userId: "user-1", canSeeAllCustody: true },
      })
    );

    const [booking] = map.get("asset-1")!;
    expect(booking.custodianUser?.id).toBe("someone-else");
  });
});

describe("fetchBarcodesBatch", () => {
  it("returns an empty map without querying when the org lacks the barcode entitlement", async () => {
    const map = await fetchBarcodesBatch(makeArgs({ barcodesEnabled: false }));

    expect(map.size).toBe(0);
    expect(dbMock.barcode.findMany).not.toHaveBeenCalled();
  });

  it("scopes the query to the caller's organization and requested ids when enabled", async () => {
    dbMock.barcode.findMany.mockResolvedValue([]);
    const args = makeArgs({ barcodesEnabled: true });

    await fetchBarcodesBatch(args);

    const call = dbMock.barcode.findMany.mock.calls[0][0];
    expect(call.where.assetId.in).toEqual(args.ids);
    expect(call.where.organizationId).toBe(ORG_ID);
    expect(call.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("groups ordered barcodes by assetId, omitting assets with none", async () => {
    dbMock.barcode.findMany.mockResolvedValue([
      { id: "barcode-1", type: "Code128", value: "ABC123", assetId: "asset-1" },
      { id: "barcode-2", type: "Code39", value: "DEF456", assetId: "asset-1" },
    ]);

    const map = await fetchBarcodesBatch(makeArgs({ barcodesEnabled: true }));

    expect(map.get("asset-1")).toEqual([
      { id: "barcode-1", type: "Code128", value: "ABC123" },
      { id: "barcode-2", type: "Code39", value: "DEF456" },
    ]);
    expect(map.has("asset-2")).toBe(false);
  });
});

describe("real-DB smokes", () => {
  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchCustodyBatch returns org-scoped, grouped custody",
    async () => {
      const db = getFixtureDb();
      const sample = await db.custody.findFirst({
        select: { assetId: true, asset: { select: { organizationId: true } } },
      });
      if (!sample) return;

      const map = await fetchCustodyBatch(
        makeArgs({
          ids: [sample.assetId],
          organizationId: sample.asset.organizationId,
        }),
        db
      );

      const custody = map.get(sample.assetId);
      expect(custody).toBeDefined();
      expect(custody!.length).toBeGreaterThan(0);
      for (const entry of custody!) {
        expect(typeof entry.custodian.name).toBe("string");
      }
    }
  );

  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchCustodyBatch synthesises a single booking-derived custodian for a CHECKED_OUT asset with no direct custody",
    async () => {
      const db = getFixtureDb();
      // A CHECKED_OUT asset in an active booking but with NO direct Custody
      // row — the only case that exercises the booking-derived CASE branch.
      const ba = await db.bookingAsset.findFirst({
        where: {
          booking: { status: { in: ["ONGOING", "OVERDUE"] } },
          asset: { status: "CHECKED_OUT", custody: { none: {} } },
        },
        select: {
          assetId: true,
          booking: { select: { organizationId: true } },
        },
      });
      if (!ba) return;

      const map = await fetchCustodyBatch(
        makeArgs({
          ids: [ba.assetId],
          organizationId: ba.booking.organizationId,
        }),
        db
      );

      const custody = map.get(ba.assetId);
      expect(custody).toBeDefined();
      // Booking-derived custody is always exactly one synthetic entry.
      expect(custody!.length).toBe(1);
      expect(typeof custody![0].custodian.name).toBe("string");
    }
  );

  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchBookingsBatch returns org-scoped, per-slice bookings with string from/to",
    async () => {
      const db = getFixtureDb();
      const sample = await db.bookingAsset.findFirst({
        where: {
          booking: { status: { in: ["RESERVED", "ONGOING", "OVERDUE"] } },
        },
        select: {
          assetId: true,
          booking: { select: { organizationId: true } },
        },
      });
      if (!sample) return;

      const map = await fetchBookingsBatch(
        makeArgs({
          ids: [sample.assetId],
          organizationId: sample.booking.organizationId,
        }),
        db
      );

      const bookings = map.get(sample.assetId);
      expect(bookings).toBeDefined();
      expect(bookings!.length).toBeGreaterThan(0);
      for (const booking of bookings!) {
        expect(typeof booking.from).toBe("string");
        expect(typeof booking.to).toBe("string");
      }
    }
  );

  it.skipIf(!FIXTURE_DB_AVAILABLE)(
    "fetchBarcodesBatch returns org-scoped, grouped, ordered barcodes",
    async () => {
      const db = getFixtureDb();
      const sample = await db.barcode.findFirst({
        where: { assetId: { not: null } },
        select: { assetId: true, organizationId: true },
      });
      if (!sample || !sample.assetId) return;

      const map = await fetchBarcodesBatch(
        makeArgs({
          ids: [sample.assetId],
          organizationId: sample.organizationId,
          barcodesEnabled: true,
        }),
        db
      );

      const barcodes = map.get(sample.assetId);
      expect(barcodes).toBeDefined();
      expect(barcodes!.length).toBeGreaterThan(0);
      for (const barcode of barcodes!) {
        expect(typeof barcode.value).toBe("string");
      }
    }
  );
});
