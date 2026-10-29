/**
 * Tests for the booking pushes: one reaches the custodian alone, in the
 * custodian's date format; a custodian change also tells the custodian it
 * replaced; and nobody is pushed about their own action.
 *
 * @see {@link file://./push.server.ts}
 */
import { sendPush } from "~/modules/push/service.server";
import type { NotificationRecipient } from "./notification-recipients.server";
import {
  sendBookingPushToCustodian,
  sendBookingPushToReplacedCustodian,
} from "./push.server";

// @vitest-environment node

// why: sendPush queues a pg-boss job; the queue and delivery are the push
// module's concern and have their own tests
vi.mock("~/modules/push/service.server", () => ({
  sendPush: vi.fn().mockResolvedValue(undefined),
}));

const booking = {
  id: "booking-1",
  name: "Field kit",
  organizationId: "org-1",
  from: new Date("2026-10-01T08:00:00Z"),
  to: new Date("2026-10-03T17:00:00Z"),
};

const hints = { timeZone: "UTC", locale: "en-US" };

/** An email recipient with no format prefs of their own; overrides win. */
function recipient(
  overrides: Partial<NotificationRecipient> &
    Pick<NotificationRecipient, "userId" | "reason">
): NotificationRecipient {
  return {
    email: `${overrides.userId}@example.com`,
    firstName: null,
    lastName: null,
    dateFormat: null,
    timeFormat: null,
    weekStart: null,
    timeZone: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendBookingPushToCustodian", () => {
  it("pushes once to the custodian alone, with the dates in their format", () => {
    sendBookingPushToCustodian({
      eventType: "RESERVATION",
      booking,
      hints,
      actorUserId: "admin-1",
      recipients: [
        recipient({ userId: "creator-1", reason: "creator" }),
        recipient({
          userId: "custodian-1",
          reason: "custodian",
          dateFormat: "DD_MM_YYYY",
          timeFormat: "H24",
          weekStart: "MONDAY",
          timeZone: "Europe/Berlin",
        }),
        recipient({ userId: "admin-1", reason: "admin" }),
        recipient({ userId: "watcher-1", reason: "always_notify" }),
        recipient({ userId: "guest-1", reason: "booking_recipient" }),
      ],
    });

    expect(vi.mocked(sendPush).mock.calls).toEqual([
      [
        {
          userIds: ["custodian-1"],
          organizationId: "org-1",
          category: "bookings",
          title: "✅ Booking reserved (Field kit)",
          body: "01/10/2026, 10:00 to 03/10/2026, 19:00",
          url: "/bookings/booking-1?orgId=org-1",
        },
      ],
    ]);
  });

  it("formats with the acting user's hints where the custodian set no prefs", () => {
    sendBookingPushToCustodian({
      eventType: "CHECKOUT_REMINDER",
      booking,
      hints,
      actorUserId: undefined,
      recipients: [recipient({ userId: "custodian-1", reason: "custodian" })],
    });

    expect(vi.mocked(sendPush).mock.calls[0][0]).toMatchObject({
      title: "🔔 Checkout reminder (Field kit)",
      body: "Checkout on 10/01/2026, 8:00 AM",
    });
  });

  it("sends a booking update to the custodian through the same rule", () => {
    sendBookingPushToCustodian({
      eventType: "UPDATE",
      booking,
      hints,
      actorUserId: "admin-1",
      recipients: [recipient({ userId: "custodian-1", reason: "custodian" })],
    });

    expect(vi.mocked(sendPush).mock.calls).toEqual([
      [
        {
          userIds: ["custodian-1"],
          organizationId: "org-1",
          category: "bookings",
          title: "📝 Booking updated (Field kit)",
          body: "Details changed. Tap to review.",
          url: "/bookings/booking-1?orgId=org-1",
        },
      ],
    ]);
  });

  it("sends nothing to a custodian who made the change themself", () => {
    sendBookingPushToCustodian({
      eventType: "CHECKIN",
      booking,
      hints,
      actorUserId: "custodian-1",
      recipients: [
        recipient({ userId: "custodian-1", reason: "custodian" }),
        recipient({ userId: "creator-1", reason: "creator" }),
      ],
    });

    expect(sendPush).not.toHaveBeenCalled();
  });

  it("sends nothing when no recipient is the custodian", () => {
    sendBookingPushToCustodian({
      eventType: "CANCEL",
      booking,
      hints,
      actorUserId: undefined,
      recipients: [
        recipient({ userId: "creator-1", reason: "creator" }),
        recipient({ userId: "admin-1", reason: "admin" }),
      ],
    });

    expect(sendPush).not.toHaveBeenCalled();
  });
});

describe("sendBookingPushToReplacedCustodian", () => {
  it("tells the replaced custodian they were removed, opening the bookings list", () => {
    sendBookingPushToReplacedCustodian({
      booking,
      replacedCustodianUserId: "custodian-0",
      actorUserId: "admin-1",
    });

    expect(vi.mocked(sendPush).mock.calls).toEqual([
      [
        {
          userIds: ["custodian-0"],
          organizationId: "org-1",
          category: "bookings",
          title: "You were removed from a booking",
          body: "Field kit",
          url: "/bookings?orgId=org-1",
        },
      ],
    ]);
  });

  it("sends nothing to a replaced custodian who made the change themself", () => {
    sendBookingPushToReplacedCustodian({
      booking,
      replacedCustodianUserId: "custodian-0",
      actorUserId: "custodian-0",
    });

    expect(sendPush).not.toHaveBeenCalled();
  });
});
