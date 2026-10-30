/**
 * Booking page action: the `checkOut` intent's handling of the end date picked
 * in the expired-reservation prompt.
 *
 * With `checkoutIntentChoice=with-new-end-date`, the picked `expiredCheckoutNewTo`
 * wall clock is read in the acting user's resolved timezone, validated with the
 * extend schema and handed to `checkoutBooking` as `newEndDate`. A refusal is a
 * 400 reported under `expiredCheckoutNewTo` (never the booking form's
 * `endDate`), and nothing is checked out. Any other choice hands over no date.
 *
 * @see {@link file://./../../../app/routes/_layout+/bookings.$bookingId.overview.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import { CheckoutIntentEnum } from "~/components/booking/checkout-dialog";

// why: data() must produce a real Response so statuses and bodies are assertable
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: requirePermission loads the membership from the database; the caller is
// an ADMIN so the ownership guard is a no-op and the date handling is under test
const { requirePermissionMock } = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
}));
vi.mock("~/utils/roles.server", () => ({
  requirePermission: requirePermissionMock,
}));

// why: checkoutBooking is the sink whose arguments are under test, and it
// writes to the database; the rest of the service stays real
const { checkoutBookingMock } = vi.hoisted(() => ({
  checkoutBookingMock: vi.fn(),
}));
vi.mock("~/modules/booking/service.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  checkoutBooking: checkoutBookingMock,
}));

// why: the user's resolved prefs come from the database; a non-UTC zone proves
// the picked wall clock is read in the user's zone, not the server's
const { resolveUserFormatPrefsByIdMock } = vi.hoisted(() => ({
  resolveUserFormatPrefsByIdMock: vi.fn(),
}));
vi.mock("~/utils/date-format.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveUserFormatPrefsById: resolveUserFormatPrefsByIdMock,
}));

// why: working hours and booking settings are database reads; disabled working
// hours and no max length keep the extend schema to the future-date check
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn().mockResolvedValue({
    enabled: false,
    weeklySchedule: {},
    overrides: [],
  }),
}));
vi.mock("~/modules/booking-settings/service.server", async () => {
  const { createBookingSettings } = await import("@factories");
  return {
    getBookingSettingsForOrganization: vi
      .fn()
      .mockResolvedValue(createBookingSettings()),
  };
});

// why: the actor lookup, notes, toast and org cookie run around the check-out
// and would otherwise reach the database or the event emitter
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

// why: no database in tests; the action reads only the booking's window and
// ownership fields before the intent switch
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findFirstOrThrow: vi.fn().mockImplementation(() =>
        Promise.resolve({
          id: "booking-1",
          status: "RESERVED",
          from: new Date("2026-01-01T09:00:00Z"),
          to: new Date("2026-01-02T09:00:00Z"),
          creatorId: "user-1",
          custodianUserId: null,
        })
      ),
    },
  },
}));

import { action } from "~/routes/_layout+/bookings.$bookingId.overview";

// @vitest-environment node

/** The signed-in user making every request. */
const CALLER = "user-1";

/** The stored window the action reads from the booking row. */
const BOOKING_FROM = new Date("2026-01-01T09:00:00Z");
const BOOKING_TO = new Date("2026-01-02T09:00:00Z");

/** The acting user's resolved zone: UTC+2 in January, never the server's UTC. */
const USER_ZONE = "Europe/Sofia";

/** POSTs `body` to the booking page action as {@link CALLER}. */
function post(body: Record<string, string>) {
  return action({
    request: new Request("https://app.shelf.nu/bookings/booking-1/overview", {
      method: "POST",
      body: new URLSearchParams(body),
    }),
    params: { bookingId: "booking-1" },
    context: { getSession: () => ({ userId: CALLER }) },
  } as never) as unknown as Promise<Response>;
}

describe("booking page checkOut intent: expired-reservation end date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue(
      permissionContext({ roles: [OrganizationRoles.ADMIN] })
    );
    resolveUserFormatPrefsByIdMock.mockResolvedValue({
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      weekStartsOn: 0,
      timeZone: USER_ZONE,
    });
    checkoutBookingMock.mockResolvedValue({
      id: "booking-1",
      name: "Shoot",
      bookingAssets: [],
    });
  });

  it("hands checkoutBooking the picked end date, read in the user's zone", async () => {
    const response = await post({
      intent: "checkOut",
      checkoutIntentChoice: CheckoutIntentEnum["with-new-end-date"],
      expiredCheckoutNewTo: "2099-01-15T14:30",
    });

    expect(response.status).toBe(200);
    expect(checkoutBookingMock).toHaveBeenCalledTimes(1);
    expect(checkoutBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "booking-1",
        intentChoice: CheckoutIntentEnum["with-new-end-date"],
        // 14:30 in Sofia (UTC+2 in January) is 12:30 UTC.
        newEndDate: new Date("2099-01-15T12:30:00.000Z"),
        from: BOOKING_FROM,
        to: BOOKING_TO,
      })
    );
  });

  it("refuses a missing end date with a 400 under expiredCheckoutNewTo and checks nothing out", async () => {
    const response = await post({
      intent: "checkOut",
      checkoutIntentChoice: CheckoutIntentEnum["with-new-end-date"],
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: {
        additionalData: {
          validationErrors: Record<string, { message: string }>;
        };
      };
    };
    const validationErrors = body.error.additionalData.validationErrors;
    expect(validationErrors.expiredCheckoutNewTo.message).toEqual(
      expect.any(String)
    );
    // The booking form's own End Date field must not show this error.
    expect(validationErrors).not.toHaveProperty("endDate");
    expect(checkoutBookingMock).not.toHaveBeenCalled();
  });

  it("hands checkoutBooking no new end date when the stored dates are kept", async () => {
    const response = await post({
      intent: "checkOut",
      checkoutIntentChoice: CheckoutIntentEnum["without-adjusted-date"],
    });

    expect(response.status).toBe(200);
    expect(checkoutBookingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        intentChoice: CheckoutIntentEnum["without-adjusted-date"],
        newEndDate: null,
      })
    );
    // Only the new-end-date choice reads the user's zone.
    expect(resolveUserFormatPrefsByIdMock).not.toHaveBeenCalled();
  });
});
