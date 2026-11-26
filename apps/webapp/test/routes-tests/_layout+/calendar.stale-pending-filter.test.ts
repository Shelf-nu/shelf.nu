/**
 * Calendar loader: a "Pending approval" filter that no longer exists.
 *
 * With both approval switches off the status picker no longer offers
 * "Pending approval", and the bookings query matches nothing for it, so a
 * bookmarked `/calendar?status=PENDING_APPROVAL` would render an empty
 * calendar. The loader redirects to the same calendar without the status,
 * keeping the rest of the query.
 *
 * @see {@link file://../../../app/routes/_layout+/calendar.tsx}
 * @see {@link file://../../../app/modules/booking/stale-pending-filter.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { permissionContext } from "@helpers/role-access";

import { db } from "~/database/db.server";
import { getBookingsForCalendar } from "~/modules/booking/service.server";
import { loader } from "~/routes/_layout+/calendar";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the permission gate is exercised elsewhere; this test feeds its result
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the approval switches are a database read; the test sets them
vi.mock("~/database/db.server", () => ({
  db: { bookingSettings: { findUnique: vi.fn() } },
}));

// why: the calendar's event query is database work; reaching it means the
// loader did not redirect
vi.mock("~/modules/booking/service.server", () => ({
  getBookingsForCalendar: vi.fn(),
}));

// why: the filter and form data beside the events are database reads this
// test does not look at
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMemberForCustodianFilter: vi.fn(async () => ({ teamMembers: [] })),
  getTeamMemberForForm: vi.fn(async () => ({ teamMembers: [] })),
}));
vi.mock("~/modules/tag/service.server", () => ({
  getTagsForBookingTagsFilter: vi.fn(async () => ({ tags: [] })),
}));
vi.mock("~/modules/calendar-subscription/service.server", () => ({
  getMemberCalendarFeedUrl: vi.fn(async () => null),
}));

const context = {
  getSession: () => ({ userId: "caller" }),
} as unknown as Parameters<typeof loader>[0]["context"];

/** Runs the loader for `query`; returns the Response it produced or threw. */
async function load(query: string): Promise<Response | unknown> {
  try {
    return await loader(
      createLoaderArgs({
        request: new Request(`http://localhost:3000/calendar${query}`),
        context,
      })
    );
  } catch (thrown) {
    return thrown;
  }
}

describe("calendar loader stale Pending approval filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      ...(permissionContext({ roles: ["ADMIN"] }) as object),
      currentOrganization: { id: "org-1", type: "TEAM" },
    } as unknown as Awaited<ReturnType<typeof requirePermission>>);
  });

  it("redirects to the calendar without the status once approval is off", async () => {
    vi.mocked(db.bookingSettings.findUnique).mockResolvedValue({
      requireApprovalForBase: false,
      requireApprovalForSelfService: false,
    } as never);

    const res = (await load(
      "?status=PENDING_APPROVAL&start=2026-11-01&end=2026-11-30"
    )) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(
      "/calendar?start=2026-11-01&end=2026-11-30"
    );
    expect(getBookingsForCalendar).not.toHaveBeenCalled();
  });

  it("keeps the filter while approval is on", async () => {
    vi.mocked(db.bookingSettings.findUnique).mockResolvedValue({
      requireApprovalForBase: true,
      requireApprovalForSelfService: false,
    } as never);

    await load("?status=PENDING_APPROVAL");

    expect(getBookingsForCalendar).toHaveBeenCalled();
  });
});
