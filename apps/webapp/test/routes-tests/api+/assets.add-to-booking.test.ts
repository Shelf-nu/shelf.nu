/**
 * Adding assets to an existing booking when some are already in it.
 *
 * The dialog first shows which selected assets the booking already holds and
 * offers "Add only the rest". When every selected asset is already there, what
 * is left to add is nothing — and that has to be said, not passed on as an
 * empty list and reported as assets that no longer exist.
 *
 * @see {@link file://./../../../app/routes/api+/assets.add-to-booking.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";
import { assertIsDataWithResponseInit } from "@helpers/assertions";

import {
  processBooking,
  updateBookingAssets,
} from "~/modules/booking/service.server";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/api+/assets.add-to-booking";

// @vitest-environment node

// why: the route imports the real Prisma client transitively; every read and
// write it makes goes through the services stubbed below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the permission check reads the session cookie and the database; it is
// not what these cases vary.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: `processBooking` loads the booking and its assets from the database —
// its result is the input under test. `updateBookingAssets` is the write that
// must not happen when there is nothing to add.
vi.mock("~/modules/booking/service.server", () => ({
  processBooking: vi.fn(),
  updateBookingAssets: vi.fn(),
}));

// why: writes notes through Prisma, and is only reached after a successful add.
vi.mock("~/modules/note/service.server", () => ({ createNotes: vi.fn() }));
// why: reads the acting user from the database, only after a successful add.
vi.mock("~/modules/user/service.server", () => ({ getUserByID: vi.fn() }));
// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** A booking that already holds both of the assets being added. */
const BOOKING_WITH_BOTH = {
  bookingAssets: [
    { assetId: "asset-1", asset: { id: "asset-1", title: "Drill" } },
    { assetId: "asset-2", asset: { id: "asset-2", title: "Saw" } },
  ],
};

async function submit(fields: Record<string, string>) {
  const body = new URLSearchParams({ id: "booking-1", ...fields });
  body.append("assetsIds[]", "asset-1");
  body.append("assetsIds[]", "asset-2");

  const response = await action(
    createActionArgs({
      request: new Request("http://localhost/api/assets/add-to-booking", {
        method: "POST",
        body,
      }),
      context: { getSession: () => ({ userId: "user-1" }) } as never,
    })
  );

  assertIsDataWithResponseInit(response);
  const { error } = response.data as { error: { message: string } };
  return { message: error.message, status: response.init?.status };
}

describe("add assets to an existing booking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
    } as never);
    vi.mocked(processBooking).mockResolvedValue({
      finalAssetIds: ["asset-1", "asset-2"],
      bookingInfo: BOOKING_WITH_BOTH,
    } as never);
  });

  it("says every asset is already in the booking when only the rest is asked for and none is left", async () => {
    const result = await submit({ addOnlyRestAssets: "true" });

    expect(result).toEqual({
      message: expect.stringContaining(
        "already contains all the selected assets"
      ),
      status: 400,
    });
    expect(updateBookingAssets).not.toHaveBeenCalled();
  });

  it("answers 400 when the selection overlaps the booking", async () => {
    const result = await submit({});

    expect(result.status).toBe(400);
    expect(updateBookingAssets).not.toHaveBeenCalled();
  });
});
