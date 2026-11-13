/**
 * Ongoing booking route: which viewers learn which booking holds an asset,
 * whether it opens for them, and which booking fields leave the server.
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

/** The answer when the booking is named, with the fields old tabs read. */
function named(canOpen: boolean) {
  return {
    error: null,
    booking: { id: "booking-1", name: "Field shoot", canOpen },
    id: "booking-1",
    name: "Field shoot",
  };
}

describe("ongoing booking route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getOngoingBookingForAsset).mockResolvedValue(
      heldByAnother as never
    );
  });

  it("names the booking to an admin, with only its id and name", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({ roles: ["ADMIN"] }) as never
    );

    expect(await call()).toEqual(named(true));
    expect(getOngoingBookingForAsset).toHaveBeenCalledWith({
      assetId: "asset-1",
      organizationId: "org-1",
    });
  });

  it.each(["BASE", "SELF_SERVICE"] as const)(
    "withholds another person's booking from %s while the workspace hides custody and bookings",
    async (role) => {
      vi.mocked(rolesServer.requirePermission).mockResolvedValue(
        permissionContext({ roles: [role] }) as never
      );

      expect(await call()).toEqual({ error: null, booking: null });
    }
  );

  it("withholds the booking while only bookings are shown, as the mobile asset detail does", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({
        roles: ["BASE"],
        workspace: { baseUserCanSeeBookings: true },
      }) as never
    );

    expect(await call()).toEqual({ error: null, booking: null });
  });

  it("names the booking without opening it while only custody is shown", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({
        roles: ["BASE"],
        workspace: { baseUserCanSeeCustody: true },
      }) as never
    );

    expect(await call()).toEqual(named(false));
  });

  it("names and opens the booking while the workspace shows custody and bookings", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({
        roles: ["SELF_SERVICE"],
        workspace: {
          selfServiceCanSeeCustody: true,
          selfServiceCanSeeBookings: true,
        },
      }) as never
    );

    expect(await call()).toEqual(named(true));
  });

  it.each([
    [
      "the team member link",
      { custodianUserId: null, custodianTeamMember: { userId: "user-1" } },
    ],
    ["the user link", { custodianUserId: "user-1", custodianTeamMember: null }],
  ])(
    "names and opens a booking a Base user holds through %s",
    async (_link, links) => {
      vi.mocked(rolesServer.requirePermission).mockResolvedValue(
        permissionContext({ roles: ["BASE"] }) as never
      );
      vi.mocked(getOngoingBookingForAsset).mockResolvedValueOnce({
        ...heldByAnother,
        ...links,
      } as never);

      expect(await call()).toEqual(named(true));
    }
  );

  it("answers booking: null when no active booking holds the asset", async () => {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue(
      permissionContext({ roles: ["ADMIN"] }) as never
    );
    vi.mocked(getOngoingBookingForAsset).mockResolvedValueOnce(null);

    expect(await call()).toEqual({ error: null, booking: null });
  });
});
