/**
 * Booking email helpers: the actor line in the plain-text body, the lookup
 * that names the acting user, the "Updated by" line on booking update
 * emails, and the pushes the update and check-in reminder send.
 *
 * @see {@link file://./email-helpers.ts}
 */
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import type { BookingEmailActor } from "~/emails/types";
import { sendPush } from "~/modules/push/service.server";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { BOOKING_INCLUDE_FOR_EMAIL } from "./constants";
import {
  cancelledBookingEmailContent,
  completedBookingEmailContent,
  resolveBookingEmailActor,
  sendBookingUpdatedEmail,
  sendCheckinReminder,
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

// why: sendPush queues a pg-boss job; the queue and delivery are the push
// module's concern and have their own tests
vitest.mock("~/modules/push/service.server", () => ({
  sendPush: vitest.fn().mockResolvedValue(undefined),
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

/** A reserved booking, as the email include loads it. */
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

/** The update push to the custodian, for an update that kept them. */
const updatePush = {
  userIds: ["custodian-2"],
  organizationId: "org-1",
  category: "bookings",
  title: "📝 Booking updated (Field kit)",
  body: "Details changed. Tap to review.",
  url: "/bookings/booking-1?orgId=org-1",
};

/** The update push to the new custodian, for an update that made them so. */
const handoverPush = {
  ...updatePush,
  body: "You are now the custodian. Tap to review.",
};

/** The removal push to the custodian the update replaced. */
const removedPush = {
  userIds: ["custodian-1"],
  organizationId: "org-1",
  category: "bookings",
  title: "You were removed from a booking",
  body: "Field kit",
  url: "/bookings?orgId=org-1",
};

/** The new custodian, as the recipient resolver returns them. */
const newCustodianRecipient = {
  email: "new-custodian@example.com",
  firstName: "Nia",
  lastName: "New",
  userId: "custodian-2",
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H24",
  weekStart: "MONDAY",
  timeZone: "Europe/Berlin",
  reason: "custodian",
} as const;

/** The replaced custodian, still a recipient because they created the booking. */
const oldCustodianAsCreator = {
  email: "old-custodian@example.com",
  firstName: "Casey",
  lastName: "Custodian",
  userId: "custodian-1",
  dateFormat: null,
  timeFormat: null,
  weekStart: null,
  timeZone: null,
  reason: "creator",
} as const;

describe("sendBookingUpdatedEmail", () => {
  beforeEach(() => {
    // @ts-expect-error partial booking row for the email include
    mockedFindBooking.mockResolvedValue(booking);
    mockedRecipients.mockResolvedValue([newCustodianRecipient]);
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

  it("pushes the handover to the new custodian and the removal to the one they replaced", async () => {
    await sendBookingUpdatedEmail({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "editor-1",
      changes: ["Custodian changed from Casey Custodian to Nia New"],
      hints: { timeZone: "UTC", locale: "en-US" },
      oldCustodianEmail: "old-custodian@example.com",
    });

    expect(vitest.mocked(sendPush).mock.calls).toEqual([
      [handoverPush],
      [removedPush],
    ]);
  });

  it("leaves a replaced custodian who made the change out of the push", async () => {
    await sendBookingUpdatedEmail({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "custodian-1",
      changes: ["Custodian changed from Casey Custodian to Nia New"],
      hints: { timeZone: "UTC", locale: "en-US" },
      oldCustodianEmail: "old-custodian@example.com",
    });

    expect(mockedSendEmail).toHaveBeenCalledOnce();
    expect(vitest.mocked(sendPush).mock.calls).toEqual([[handoverPush]]);
  });

  it("pushes the generic update to a custodian the update kept", async () => {
    await sendBookingUpdatedEmail({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "editor-1",
      changes: ["Description changed"],
      hints: { timeZone: "UTC", locale: "en-US" },
    });

    expect(vitest.mocked(sendPush).mock.calls).toEqual([[updatePush]]);
  });

  it("custodian is the editor: email sent, no push", async () => {
    await sendBookingUpdatedEmail({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "custodian-2",
      changes: ["Description changed"],
      hints: { timeZone: "UTC", locale: "en-US" },
    });

    expect(mockedSendEmail.mock.calls.map(([payload]) => payload.to)).toEqual([
      "new-custodian@example.com",
    ]);
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("an admin who makes themself custodian gets the email and no push; the replaced custodian is pushed", async () => {
    await sendBookingUpdatedEmail({
      bookingId: "booking-1",
      organizationId: "org-1",
      userId: "custodian-2",
      changes: ["Custodian changed from Casey Custodian to Nia New"],
      hints: { timeZone: "UTC", locale: "en-US" },
      oldCustodianEmail: "old-custodian@example.com",
    });

    expect(mockedSendEmail.mock.calls.map(([payload]) => payload.to)).toEqual([
      "new-custodian@example.com",
      "old-custodian@example.com",
    ]);
    expect(vitest.mocked(sendPush).mock.calls).toEqual([[removedPush]]);
  });

  describe("when the replaced custodian is still a recipient, as the creator", () => {
    beforeEach(() => {
      mockedRecipients.mockResolvedValue([
        newCustodianRecipient,
        oldCustodianAsCreator,
      ]);
    });

    it("emails them once and pushes them the removal", async () => {
      await sendBookingUpdatedEmail({
        bookingId: "booking-1",
        organizationId: "org-1",
        userId: "editor-1",
        changes: ["Custodian changed from Casey Custodian to Nia New"],
        hints: { timeZone: "UTC", locale: "en-US" },
        oldCustodianEmail: "old-custodian@example.com",
      });

      expect(mockedSendEmail.mock.calls.map(([payload]) => payload.to)).toEqual(
        ["new-custodian@example.com", "old-custodian@example.com"]
      );
      // The recipient row already identifies them; no lookup by email
      expect(mockedFindUser).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: { email: "old-custodian@example.com" },
        })
      );
      expect(vitest.mocked(sendPush).mock.calls).toEqual([
        [handoverPush],
        [removedPush],
      ]);
    });

    it("emails them once and pushes them nothing when they made the change", async () => {
      await sendBookingUpdatedEmail({
        bookingId: "booking-1",
        organizationId: "org-1",
        userId: "custodian-1",
        changes: ["Custodian changed from Casey Custodian to Nia New"],
        hints: { timeZone: "UTC", locale: "en-US" },
        oldCustodianEmail: "old-custodian@example.com",
      });

      expect(mockedSendEmail.mock.calls.map(([payload]) => payload.to)).toEqual(
        ["new-custodian@example.com", "old-custodian@example.com"]
      );
      expect(vitest.mocked(sendPush).mock.calls).toEqual([[handoverPush]]);
    });
  });
});

describe("sendCheckinReminder", () => {
  it("emails every recipient and pushes once, to the custodian", async () => {
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
      {
        email: "creator@example.com",
        firstName: "Cora",
        lastName: "Creator",
        userId: "creator-1",
        dateFormat: null,
        timeFormat: null,
        weekStart: null,
        timeZone: null,
        reason: "creator",
      },
    ]);

    await sendCheckinReminder(
      // @ts-expect-error partial booking row for the email include
      booking,
      2,
      { timeZone: "UTC", locale: "en-US" },
      "org-1"
    );

    expect(mockedSendEmail.mock.calls.map(([payload]) => payload.to)).toEqual([
      "new-custodian@example.com",
      "creator@example.com",
    ]);
    expect(mockedSendEmail.mock.calls[0][0].subject).toBe(
      "🔔 Checkin reminder (Field kit) - shelf.nu"
    );
    expect(vitest.mocked(sendPush).mock.calls).toEqual([
      [
        {
          userIds: ["custodian-2"],
          organizationId: "org-1",
          category: "bookings",
          title: "🔔 Checkin reminder (Field kit)",
          body: "Checkin on 03/10/2026, 19:00",
          url: "/bookings/booking-1?orgId=org-1",
        },
      ],
    ]);
  });

  it("emails without a push when the caller already pushed about the booking", async () => {
    mockedRecipients.mockResolvedValue([newCustodianRecipient]);

    await sendCheckinReminder(
      // @ts-expect-error partial booking row for the email include
      booking,
      2,
      { timeZone: "UTC", locale: "en-US" },
      "org-1",
      { push: false }
    );

    expect(mockedSendEmail).toHaveBeenCalledOnce();
    expect(sendPush).not.toHaveBeenCalled();
  });
});
