// @vitest-environment node
/**
 * The extend horizon loader, `api+/bookings.$bookingId.next-reservations`.
 *
 * @see {@link file://./../../../app/routes/api+/bookings.$bookingId.next-reservations.ts}
 */
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { permissionContext } from "@helpers/role-access";

import { db } from "~/database/db.server";
import { loadNextReservations } from "~/modules/booking/next-reservations.server";
import { loader } from "~/routes/api+/bookings.$bookingId.next-reservations";
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

// why: data() returns a fetch Response so the loader can be invoked directly,
// with no router runtime to stand up.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

// why: each test supplies the workspace and role the permission check
// resolves to, rather than running the real permission machinery.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the database is external; the booking lookup is the only read.
vi.mock("~/database/db.server", () => ({
  db: { booking: { findFirst: vi.fn() } },
}));

// why: the horizon query has its own tests; this suite is about the guards.
vi.mock("~/modules/booking/next-reservations.server", () => ({
  loadNextReservations: vi.fn(),
}));

const HORIZON = { horizon: null, byAssetId: {}, byKitId: {} };

function buildArgs(): LoaderFunctionArgs {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(
      "https://example.com/api/bookings/b1/next-reservations"
    ),
    params: { bookingId: "b1" },
  } as unknown as LoaderFunctionArgs;
}

/** Runs the loader; refusals are returned, not thrown. */
async function run(): Promise<Response> {
  return (await loader(buildArgs())) as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(permissionContext() as never);
  vi.mocked(db.booking.findFirst).mockResolvedValue({
    id: "b1",
    creatorId: "someone-else",
    custodianUserId: null,
  } as never);
  vi.mocked(loadNextReservations).mockResolvedValue(HORIZON as never);
});

describe("next reservations loader", () => {
  it("returns the horizon for a booking the viewer may extend", async () => {
    const response = await run();

    expect(response.status).toBe(200);
    expect((await response.json()).nextReservations).toEqual(HORIZON);
    expect(loadNextReservations).toHaveBeenCalledWith({
      organizationId: "org-1",
      bookingId: "b1",
      viewer: { userId: "user-1", seesAllBookings: true },
    });
  });

  it("refuses a Self Service viewer on a booking they do not hold with 403", async () => {
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({ roles: ["SELF_SERVICE"] }) as never
    );

    const response = await run();

    expect(response.status).toBe(403);
    expect(loadNextReservations).not.toHaveBeenCalled();
  });

  it("a SELF_SERVICE creator who is not the custodian is refused with 403", async () => {
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({ roles: ["SELF_SERVICE"] }) as never
    );
    vi.mocked(db.booking.findFirst).mockResolvedValue({
      id: "b1",
      creatorId: "user-1",
      custodianUserId: "someone-else",
      custodianTeamMember: { userId: "someone-else" },
    } as never);

    const response = await run();

    expect(response.status).toBe(403);
    expect(loadNextReservations).not.toHaveBeenCalled();
  });

  it("404s a booking from another organization", async () => {
    vi.mocked(db.booking.findFirst).mockResolvedValue(null);

    const response = await run();

    expect(response.status).toBe(404);
    expect(db.booking.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "b1", organizationId: "org-1" } })
    );
    expect(loadNextReservations).not.toHaveBeenCalled();
  });

  it("refuses a role without booking:extend", async () => {
    vi.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        label: "Permission",
        message: "Forbidden",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const response = await run();

    expect(response.status).toBe(403);
    expect(db.booking.findFirst).not.toHaveBeenCalled();
    expect(loadNextReservations).not.toHaveBeenCalled();
  });
});
