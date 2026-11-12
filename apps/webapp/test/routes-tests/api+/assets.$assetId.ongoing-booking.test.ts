/**
 * Ongoing booking route: which viewers learn which booking holds an asset, and
 * which booking fields leave the server.
 *
 * @see {@link file://./../../../app/routes/api+/assets.$assetId.ongoing-booking.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { permissionContext } from "@helpers/role-access";

import { getOngoingBookingForAsset } from "~/modules/booking/service.server";
import * as rolesServer from "~/utils/roles.server";

import { loader } from "~/routes/api+/assets.$assetId.ongoing-booking";

// @vitest-environment node

// why: the route imports the real Prisma client transitively; every read goes
// through the service stubbed below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the permission check reads the session cookie and the database; the
// cases vary only the caller's role and the workspace toggles.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the booking lookup hits the database; its query is pinned in the
// service's own test.
vi.mock("~/modules/booking/service.server", () => ({
  getOngoingBookingForAsset: vi.fn(),
}));

/** The booking row the service selects, held by someone other than the caller. */
const heldByAnother = {
  id: "booking-1",
  name: "Field shoot",
  custodianUserId: "user-2",
  custodianTeamMember: { userId: "user-2" },
};

/** Calls the loader as `user-1` and returns the response data. */
async function call() {
  const args = createLoaderArgs({
    request: new Request("http://localhost/api/assets/asset-1/ongoing-booking"),
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) } as never,
  });
  const response = (await loader(args)) as unknown as { data: unknown };
  return response.data;
}

describe("ongoing booking route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOngoingBookingForAsset).mockResolvedValue(
      heldByAnother as never
    );
  });

  it("names the booking to an admin, and only its id and name", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({ roles: ["ADMIN"] }) as never
    );

    expect(await call()).toEqual({
      error: null,
      booking: { id: "booking-1", name: "Field shoot" },
    });
    expect(getOngoingBookingForAsset).toHaveBeenCalledWith({
      assetId: "asset-1",
      organizationId: "org-1",
    });
  });

  it.each(["BASE", "SELF_SERVICE"] as const)(
    "withholds another person's booking from %s while the workspace hides bookings",
    async (role) => {
      vi.mocked(rolesServer.requirePermission).mockResolvedValue(
        permissionContext({ roles: [role] }) as never
      );

      expect(await call()).toEqual({ error: null, booking: null });
    }
  );

  it("names another person's booking to a Base user once the workspace shows bookings", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({
        roles: ["BASE"],
        workspace: { baseUserCanSeeBookings: true },
      }) as never
    );

    expect(await call()).toEqual({
      error: null,
      booking: { id: "booking-1", name: "Field shoot" },
    });
  });

  it("names a booking to a Base user who holds it through the team member link", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({ roles: ["BASE"] }) as never
    );
    vi.mocked(getOngoingBookingForAsset).mockResolvedValueOnce({
      ...heldByAnother,
      custodianUserId: null,
      custodianTeamMember: { userId: "user-1" },
    } as never);

    expect(await call()).toEqual({
      error: null,
      booking: { id: "booking-1", name: "Field shoot" },
    });
  });

  it("answers booking: null when no active booking holds the asset", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({ roles: ["ADMIN"] }) as never
    );
    vi.mocked(getOngoingBookingForAsset).mockResolvedValueOnce(null);

    expect(await call()).toEqual({ error: null, booking: null });
  });
});
