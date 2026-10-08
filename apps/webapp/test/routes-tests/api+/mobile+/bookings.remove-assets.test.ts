/**
 * Contract tests for the mobile remove-from-booking endpoint: which rows a
 * selection is allowed to delete, and what the audit trail says it deleted.
 *
 * Two ids travel in this body and they mean different things. `assetIds` is
 * everything the caller wants gone; `standaloneAssetIds` narrows that to the
 * ones whose kit-less row the user actually ticked. A caller that can see the
 * difference states it, and one that cannot leaves the field off — so absent
 * and empty are different instructions, and the route must keep them apart.
 *
 * The note the removal writes is derived separately from the delete scope, and
 * deliberately so: a caller narrowing the delete must not thereby erase its own
 * record of what it asked for.
 *
 * The suite runs without a database, so the assertions are on the arguments the
 * route hands `removeAssets` — the seam where both decisions are expressed.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/bookings.remove-assets.ts} route under test
 */

import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import type * as MobileAuthServer from "~/modules/api/mobile-auth.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import type * as BookingServiceServer from "~/modules/booking/service.server";
import { removeAssets } from "~/modules/booking/service.server";

import { action } from "~/routes/api+/mobile+/bookings.remove-assets";

import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: db is the integration boundary. `asset.findMany` serves three different
// reads in this route, so the mock branches on the `where` rather than queueing
// `mockResolvedValueOnce` — a queue would couple every test to the route's call
// order, and a leftover entry answers the next test instead of failing it.
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { findFirst: vi.fn() },
    kit: { findMany: vi.fn().mockResolvedValue([]) },
    asset: { findMany: vi.fn() },
  },
}));

// why: JWT validation, org-membership resolution and the premium gate are out
// of scope; the rest of the module stays real, including the role and custody
// predicates that decide whether the caller may remove anything at all.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<typeof MobileAuthServer>(
    "~/modules/api/mobile-auth.server"
  );
  return {
    ...actual,
    requireMobileAuth: vi.fn(),
    requireOrganizationAccess: vi.fn(),
    requireMobilePermission: vi.fn(),
    assertMobileCanUseBookings: vi.fn(),
    getMobileUserContext: vi.fn(),
  };
});

// why: `removeAssets` is the seam under test — spying on it is how the delete
// scope and the note's asset list become observable without a database.
vi.mock("~/modules/booking/service.server", async () => {
  const actual = await vi.importActual<typeof BookingServiceServer>(
    "~/modules/booking/service.server"
  );
  return {
    ...actual,
    removeAssets: vi.fn().mockResolvedValue({ id: "booking-1" }),
  };
});

// why: rate limiting is infra, not the behaviour under test — no-op it.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

const findFirstMock = vi.mocked(db.booking.findFirst);
const assetFindManyMock = vi.mocked(db.asset.findMany);
const removeAssetsMock = vi.mocked(removeAssets);

const BOOKING_ID = "booking-1";

/**
 * Answers the route's three `asset.findMany` reads from one description of the
 * world: which asset ids exist in the org, and which of those the booking
 * actually holds.
 *
 * The reads are told apart by their `where`: the attached-rows read filters on
 * `bookingAssets`, the kit expansion filters on `assetKits`, and anything else
 * is the org-ownership guard.
 */
function world({
  inOrg,
  onBooking,
  kitMembers = [],
}: {
  inOrg: string[];
  onBooking: string[];
  kitMembers?: string[];
}) {
  assetFindManyMock.mockImplementation((async (args: {
    where?: Record<string, unknown>;
  }) => {
    const where = args?.where ?? {};
    if ("bookingAssets" in where) {
      return onBooking.map((id) => ({ id, title: `Asset ${id}` }));
    }
    if ("assetKits" in where) {
      return kitMembers.map((id) => ({ id }));
    }
    return inOrg.map((id) => ({ id }));
  }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireMobileAuth).mockResolvedValue({
    user: {
      id: "user-1",
      firstName: "Sam",
      lastName: "Ree",
      displayName: null,
    },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  vi.mocked(requireOrganizationAccess).mockResolvedValue("org-1");
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: [OrganizationRoles.ADMIN] })
  );
  removeAssetsMock.mockResolvedValue({ id: BOOKING_ID } as never);
  vi.mocked(db.kit.findMany).mockResolvedValue([] as never);
  findFirstMock.mockResolvedValue({
    id: BOOKING_ID,
    status: "DRAFT",
    from: new Date("2026-01-01T00:00:00.000Z"),
    to: new Date("2026-01-02T00:00:00.000Z"),
    custodianUserId: "user-1",
    custodianTeamMember: { userId: "user-1" },
  } as never);
  world({ inOrg: [], onBooking: [] });
});

async function post(body: Record<string, unknown>) {
  return action(
    createActionArgs({
      request: new Request(
        "http://localhost:3000/api/mobile/bookings/remove-assets",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ bookingId: BOOKING_ID, ...body }),
        }
      ),
      params: {},
    })
  );
}

/** The one call the route made into the service. */
function serviceCall() {
  expect(removeAssetsMock).toHaveBeenCalledTimes(1);
  return removeAssetsMock.mock.calls[0][0];
}

describe("POST /api/mobile/bookings/remove-assets — removal provenance", () => {
  it("reads every named id as its own row when the field is absent", async () => {
    // An older app sends no `standaloneAssetIds` at all. Its removals must keep
    // behaving exactly as they did before the field existed.
    world({ inOrg: ["a1", "a2"], onBooking: ["a1", "a2"] });

    const response = await post({ assetIds: ["a1", "a2"] });

    assertIsDataWithResponseInit(response);
    expect(serviceCall().standaloneAssetIds).toEqual(["a1", "a2"]);
  });

  it("narrows the delete to the rows the caller says it ticked", async () => {
    // `a2` was selected as a kit member, not as a row of its own, so only `a1`
    // may have its kit-less row deleted.
    world({ inOrg: ["a1", "a2"], onBooking: ["a1", "a2"] });

    await post({ assetIds: ["a1", "a2"], standaloneAssetIds: ["a1"] });

    expect(serviceCall().standaloneAssetIds).toEqual(["a1"]);
  });

  it("distinguishes an empty list from an absent one", async () => {
    // Empty is a statement: none of these ids names a loose row. It must not
    // collapse into the absent case, which means "infer it".
    world({ inOrg: ["a1"], onBooking: ["a1"] });

    await post({ assetIds: ["a1"], standaloneAssetIds: [] });

    expect(serviceCall().standaloneAssetIds).toEqual([]);
  });

  it("keeps ids the booking does not hold out of the delete scope", async () => {
    // A caller may name any org asset; only rows actually on this booking may
    // be removed, or the count and the note both overstate what happened.
    world({ inOrg: ["a1", "a2"], onBooking: ["a1"] });

    await post({ assetIds: ["a1", "a2"] });

    expect(serviceCall().standaloneAssetIds).toEqual(["a1"]);
  });

  it("cannot smuggle an id past the org guard through the narrowing field", async () => {
    // `standaloneAssetIds` narrows `assetIds`; it never widens it. Only the
    // latter is org-checked, so an id appearing solely in the former must not
    // reach the service.
    world({ inOrg: ["a1"], onBooking: ["a1"] });

    await post({ assetIds: ["a1"], standaloneAssetIds: ["a1", "foreign"] });

    expect(serviceCall().standaloneAssetIds).toEqual(["a1"]);
  });
});

describe("POST /api/mobile/bookings/remove-assets — the note", () => {
  it("names everything the caller asked for, however the delete is scoped", async () => {
    // The audit trail answers "what did this person remove", not "which rows
    // did the delete clause match". Narrowing the scope must not empty it.
    world({ inOrg: ["a1", "a2"], onBooking: ["a1", "a2"] });

    await post({ assetIds: ["a1", "a2"], standaloneAssetIds: [] });

    const call = serviceCall();
    expect(call.standaloneAssetIds).toEqual([]);
    expect(call.assets?.map((asset) => asset.id)).toEqual(["a1", "a2"]);
  });

  it("counts what was removed, not what was named", async () => {
    // `a2` is named but excluded from the standalone bucket, so its row stays.
    // Counting the request instead of the deletion would report it as removed:
    // four named, three actually gone.
    vi.mocked(db.kit.findMany).mockResolvedValue([
      { id: "kit-1", name: "Camera kit" },
    ] as never);
    world({
      inOrg: ["a1", "a2"],
      onBooking: ["a1", "a2", "m1", "m2"],
      kitMembers: ["m1", "m2"],
    });

    const response = await post({
      assetIds: ["a1", "a2"],
      kitIds: ["kit-1"],
      standaloneAssetIds: ["a1"],
    });

    assertIsDataWithResponseInit(response);
    expect((response.data as { removedCount: number }).removedCount).toBe(3);
  });

  it("leaves kit members out of the note, which the kit half already covers", async () => {
    // Listing them twice turns a kit removal into a note naming every member.
    vi.mocked(db.kit.findMany).mockResolvedValue([
      { id: "kit-1", name: "Camera kit" },
    ] as never);
    world({
      inOrg: ["a1"],
      onBooking: ["a1", "m1", "m2"],
      kitMembers: ["m1", "m2"],
    });

    await post({ assetIds: ["a1"], kitIds: ["kit-1"] });

    const call = serviceCall();
    expect(call.assets?.map((asset) => asset.id)).toEqual(["a1"]);
    expect(call.kits).toEqual([{ id: "kit-1", name: "Camera kit" }]);
  });
});
