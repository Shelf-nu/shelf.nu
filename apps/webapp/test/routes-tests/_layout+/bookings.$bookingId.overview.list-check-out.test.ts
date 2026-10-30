/**
 * Booking page action: a check-out posted from the bookings list.
 *
 * The list's row form posts `origin=bookings-list` with `checkOut` or
 * `checkOutRemaining`. That row cannot ask the "From location" question, so
 * the action refuses it when the booking has one to ask, before anything is
 * checked out. A post without `origin` (the booking page, whose dialog asks)
 * is not held to that check.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.tsx}
 * @see {@link file://./../../../app/components/booking/booking-quick-actions.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import { ShelfError } from "~/utils/error";

// why: data() must produce a real Response so statuses are assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: requirePermission loads the membership from the database; an ADMIN
// context holds `booking:checkout` and writes every booking
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi
    .fn()
    .mockResolvedValue(permissionContext({ roles: [OrganizationRoles.ADMIN] })),
}));

// why: the two check-out services are the sinks a refused post must never
// reach; everything else on the module stays real
const { checkoutBookingMock, checkoutRemainingAssetsMock } = vi.hoisted(() => ({
  checkoutBookingMock: vi.fn(),
  checkoutRemainingAssetsMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkoutBooking: checkoutBookingMock,
  checkoutRemainingAssets: checkoutRemainingAssetsMock,
}));

// why: the from-location guard reads placements; here it is driven per test
const { assertNoCheckoutSourceQuestionsMock } = vi.hoisted(() => ({
  assertNoCheckoutSourceQuestionsMock: vi.fn(),
}));
vi.mock(
  "~/modules/booking/checkout-source-location.server",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    assertNoCheckoutSourceQuestions: assertNoCheckoutSourceQuestionsMock,
  })
);

// why: the action loads working hours and the explicit scan switches before
// the switch; neither matters here and neither should reach a database
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn().mockResolvedValue(null),
}));
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn().mockResolvedValue({
    requireExplicitCheckoutForAdmin: false,
    requireExplicitCheckoutForSelfService: false,
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
  }),
}));

// why: the actor lookup, notes, toast and cookie run after a successful
// check-out and would otherwise reach the database or the event emitter
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "A",
    lastName: "B",
    displayName: null,
  }),
}));
vi.mock("~/modules/note/service.server", () => ({ createNotes: vi.fn() }));
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));
vi.mock("~/modules/organization/context.server", () => ({
  setSelectedOrganizationIdCookie: vi.fn().mockResolvedValue("org=org-1"),
}));

// why: no database in tests; the action reads the booking's status and
// ownership columns before the switch
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findFirstOrThrow: vi.fn().mockResolvedValue({
        id: "booking-1",
        status: "RESERVED",
        from: new Date("2026-08-01T09:00:00Z"),
        to: new Date("2026-08-05T17:00:00Z"),
        creatorId: "user-1",
        custodianUserId: null,
      }),
    },
  },
}));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview";

// @vitest-environment node

/** POSTs `body` to the booking page action as user-1. */
function post(body: Record<string, string>) {
  return action({
    request: new Request("https://app.shelf.nu/bookings/booking-1/overview", {
      method: "POST",
      body: new URLSearchParams(body),
    }),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as never) as unknown as Promise<Response>;
}

const CHECKED_OUT = {
  id: "booking-1",
  name: "Camera kit",
  bookingAssets: [{ assetId: "asset-1" }],
};

describe("booking page check-out posted from the bookings list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkoutBookingMock.mockResolvedValue(CHECKED_OUT);
    checkoutRemainingAssetsMock.mockResolvedValue(
      new Response(JSON.stringify({ success: true }))
    );
    assertNoCheckoutSourceQuestionsMock.mockResolvedValue(undefined);
  });

  it("refuses a row check-out that needs a from-location choice, before anything goes out", async () => {
    assertNoCheckoutSourceQuestionsMock.mockRejectedValue(
      new ShelfError({
        cause: null,
        message:
          "This booking needs a from-location choice. Open the booking to check it out.",
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = await post({
      intent: "checkOut",
      origin: "bookings-list",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining("from-location choice") },
    });
    expect(checkoutBookingMock).not.toHaveBeenCalled();
  });

  it("checks a row check-out out when there is no question to ask", async () => {
    const response = await post({
      intent: "checkOut",
      origin: "bookings-list",
    });

    expect(response.status).toBe(200);
    expect(assertNoCheckoutSourceQuestionsMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      bookingId: "booking-1",
    });
    expect(checkoutBookingMock).toHaveBeenCalledTimes(1);
  });

  it("holds the row's Check out remaining to the same guard", async () => {
    await post({
      intent: "checkOutRemaining",
      origin: "bookings-list",
      returnJson: "true",
    });

    expect(assertNoCheckoutSourceQuestionsMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      bookingId: "booking-1",
    });
    expect(checkoutRemainingAssetsMock).toHaveBeenCalledTimes(1);
  });

  it("does not hold the booking page's own check-out to it: its dialog asked", async () => {
    const response = await post({ intent: "checkOut" });

    expect(response.status).toBe(200);
    expect(assertNoCheckoutSourceQuestionsMock).not.toHaveBeenCalled();
    expect(checkoutBookingMock).toHaveBeenCalledTimes(1);
  });

  it("refuses an origin it does not know", async () => {
    const response = await post({ intent: "checkOut", origin: "phone" });

    expect(response.status).toBe(400);
    expect(checkoutBookingMock).not.toHaveBeenCalled();
  });
});
