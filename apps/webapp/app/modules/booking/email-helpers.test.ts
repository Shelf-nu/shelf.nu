/**
 * Booking email helpers: the actor line in the plain-text body, the lookup
 * that names the acting user, and the "Updated by" line on booking update
 * emails.
 *
 * @see {@link file://./email-helpers.ts}
 */
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import type { BookingEmailActor } from "~/emails/types";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { BOOKING_INCLUDE_FOR_EMAIL } from "./constants";
import {
  cancelledBookingEmailContent,
  completedBookingEmailContent,
  resolveBookingEmailActor,
  sendBookingUpdatedEmail,
} from "./email-helpers";
import { getBookingNotificationRecipients } from "./notification-recipients.server";

// @vitest-environment node

// why: the helpers read the acting user and the booking from the database
vitest.mock("~/database/db.server", () => ({
  db: {
    user: { findUnique: vitest.fn() },
    booking: { findUnique: vitest.fn() },
  },
}));

// why: sending mail is a network call; the test reads what would be sent
vitest.mock("~/emails/mail.server", () => ({
  sendEmail: vitest.fn(),
}));

// why: recipient resolution has its own suite
// (notification-recipients.server.test.ts); here each test sets the list
vitest.mock("./notification-recipients.server", () => ({
  getBookingNotificationRecipients: vitest.fn(),
}));

// why: a failed lookup is logged; keep test output quiet
vitest.mock("~/utils/logger", () => ({
  Logger: { error: vitest.fn() },
}));

const berlinPrefs: ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H24",
  weekStartsOn: 1,
  timeZone: "Europe/Berlin",
};

const actor: BookingEmailActor = {
  label: "Cancelled by",
  name: "Jo Display",
  at: new Date("2026-09-30T14:15:00Z"),
};

const baseArgs = {
  bookingName: "Field kit",
  assetsCount: 2,
  custodian: "Casey Custodian",
  from: new Date("2026-10-01T08:00:00Z"),
  to: new Date("2026-10-03T17:00:00Z"),
  bookingId: "booking-1",
  prefs: berlinPrefs,
};

/** The acting user: a display name set, so it must win over the legal name. */
const actingUser = {
  email: "jo@example.com",
  firstName: "Johanna",
  lastName: "Legal",
  displayName: "Jo Display",
};

const mockedFindUser = vitest.mocked(db.user.findUnique);
const mockedFindBooking = vitest.mocked(db.booking.findUnique);
const mockedRecipients = vitest.mocked(getBookingNotificationRecipients);
const mockedSendEmail = vitest.mocked(sendEmail);

beforeEach(() => {
  vitest.clearAllMocks();
  vitest.useFakeTimers({ toFake: ["Date"] });
  vitest.setSystemTime(new Date("2026-09-30T14:15:00Z"));
});

afterEach(() => {
  vitest.useRealTimers();
});

describe("plain-text actor line", () => {
  it("puts the actor on the line right after the event sentence, in the recipient's format", () => {
    const text = cancelledBookingEmailContent({
      ...baseArgs,
      actor,
      cancellationReason: "Venue closed",
    });

    expect(text).toContain(
      'Your booking has been cancelled: "Field kit".\n' +
        "Cancelled by: Jo Display on 30/09/2026, 16:15\n" +
        "\n" +
        "Reason: Venue closed"
    );
  });

  it("leaves the body unchanged when no actor is given", () => {
    const text = completedBookingEmailContent(baseArgs);

    expect(text).toContain(
      'Howdy,\n\nYour booking has been completed: "Field kit".\n\nField kit | 2 assets'
    );
    expect(text).not.toContain(" by: ");
  });
});

describe("resolveBookingEmailActor", () => {
  it("names the acting user by display name, stamped with the current time", async () => {
    // @ts-expect-error partial user row for the selected fields
    mockedFindUser.mockResolvedValue(actingUser);

    await expect(
      resolveBookingEmailActor({ userId: "user-1", label: "Completed by" })
    ).resolves.toEqual({
      label: "Completed by",
      name: "Jo Display",
      at: new Date("2026-09-30T14:15:00Z"),
    });
    expect(mockedFindUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: expect.objectContaining({ displayName: true }),
    });
  });

  it("falls back to the email address for a user with no name", async () => {
    mockedFindUser.mockResolvedValue(
      // @ts-expect-error partial user row for the selected fields
      {
        email: "noname@example.com",
        firstName: null,
        lastName: null,
        displayName: null,
      }
    );

    await expect(
      resolveBookingEmailActor({ userId: "user-1", label: "Deleted by" })
    ).resolves.toMatchObject({ name: "noname@example.com" });
  });

  it("returns undefined without an acting user", async () => {
    await expect(
      resolveBookingEmailActor({ userId: undefined, label: "Cancelled by" })
    ).resolves.toBeUndefined();
    expect(mockedFindUser).not.toHaveBeenCalled();
  });

  it("returns undefined instead of throwing when the lookup fails", async () => {
    mockedFindUser.mockRejectedValue(new Error("connection lost"));

    await expect(
      resolveBookingEmailActor({ userId: "user-1", label: "Cancelled by" })
    ).resolves.toBeUndefined();
  });
});

describe("sendBookingUpdatedEmail", () => {
  const booking = {
    id: "booking-1",
    name: "Field kit",
    status: "RESERVED",
    from: new Date("2026-10-01T08:00:00Z"),
    to: new Date("2026-10-03T17:00:00Z"),
    organizationId: "org-1",
    custodianUser: {
      id: "custodian-2",
      email: "new-custodian@example.com",
      firstName: "Nia",
      lastName: "New",
      displayName: null,
    },
    custodianTeamMember: null,
    organization: {
      name: "Test Org",
      customEmailFooter: null,
      owner: { email: "owner@example.com" },
    },
    _count: { bookingAssets: 2 },
  };

  beforeEach(() => {
    // @ts-expect-error partial booking row for the email include
    mockedFindBooking.mockResolvedValue(booking);
    mockedRecipients.mockResolvedValue([
      {
        email: "new-custodian@example.com",
        firstName: "Nia",
        lastName: "New",
        userId: "custodian-2",
        dateFormat: "DD_MM_YYYY",
        timeFormat: "H24",
        weekStart: "MONDAY",
        timeZone: "Europe/Berlin",
        reason: "custodian",
      },
    ]);
    mockedFindUser.mockImplementation(
      // @ts-expect-error partial user rows for the selected fields
      ({ where }: { where: { id?: string; email?: string } }) =>
        Promise.resolve(
          where.id === "editor-1"
            ? actingUser
            : // The old custodian: an account with New York prefs.
              {
                id: "custodian-1",
                dateFormat: "MM_DD_YYYY",
                timeFormat: "H12",
                weekStart: "SUNDAY",
                timeZone: "America/New_York",
              }
        )
    );
  });

  it("says who updated the booking and when, to every recipient including the old custodian", async () => {
    await sendBookingUpdatedEmail({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "editor-1",
      changes: ["Custodian changed from Casey Custodian to Nia New"],
      hints: { timeZone: "UTC", locale: "en-US" },
      oldCustodianEmail: "old-custodian@example.com",
    });

    expect(mockedFindBooking).toHaveBeenCalledWith(
      expect.objectContaining({ include: BOOKING_INCLUDE_FOR_EMAIL })
    );
    expect(mockedSendEmail).toHaveBeenCalledTimes(2);

    const [toNew, toOld] = mockedSendEmail.mock.calls.map(
      ([payload]) => payload
    );

    expect(toNew.to).toBe("new-custodian@example.com");
    expect(toNew.subject).toBe("📝 Booking updated (Field kit) - shelf.nu");
    expect(toNew.text).toContain(
      'Your booking "Field kit" has been updated.\n' +
        "Updated by: Jo Display on 30/09/2026, 16:15\n"
    );
    expect(toNew.html).toContain("Updated by:");
    expect(toNew.html).toContain("Jo Display on 30/09/2026, 16:15");
    expect(toNew.html).not.toContain("Johanna");

    expect(toOld.to).toBe("old-custodian@example.com");
    expect(toOld.text).toContain(
      "Updated by: Jo Display on 09/30/2026, 10:15 AM"
    );
    expect(toOld.html).toContain("Jo Display on 09/30/2026, 10:15 AM");
  });
});
