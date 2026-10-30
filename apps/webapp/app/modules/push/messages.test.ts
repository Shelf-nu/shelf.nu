/**
 * Tests for the notification copy: every event has a push, every tap opens a
 * page in the event's workspace, a body never repeats the name its title
 * carries, and each email subject is its push title with the site name.
 *
 * @see {@link file://./messages.ts}
 */
import {
  auditEmailSubject,
  bookingEmailSubject,
  PUSH_MESSAGES,
} from "./messages";
import type { PushEvent } from "./messages";

const BOOKING = {
  bookingId: "booking-1",
  organizationId: "org-1",
  bookingName: "Camera kit",
};

const PERIOD = { from: "01/10/2026, 10:00", to: "03/10/2026, 17:00" };

const AUDIT = {
  auditId: "audit-1",
  organizationId: "org-1",
  auditName: "Q4 count",
};

const ASSET_REMINDER = {
  assetId: "asset-1",
  organizationId: "org-1",
  reminderName: "Oil change",
  assetTitle: "Forklift 3",
};

/** One message per event, built from the fixtures above. */
const MESSAGES = {
  BOOKING_RESERVATION: PUSH_MESSAGES.BOOKING_RESERVATION({
    ...BOOKING,
    ...PERIOD,
  }),
  BOOKING_CHECKOUT_REMINDER: PUSH_MESSAGES.BOOKING_CHECKOUT_REMINDER({
    ...BOOKING,
    ...PERIOD,
  }),
  BOOKING_CHECKIN_REMINDER: PUSH_MESSAGES.BOOKING_CHECKIN_REMINDER({
    ...BOOKING,
    ...PERIOD,
  }),
  BOOKING_CHECKIN: PUSH_MESSAGES.BOOKING_CHECKIN({ ...BOOKING, ...PERIOD }),
  BOOKING_OVERDUE: PUSH_MESSAGES.BOOKING_OVERDUE({ ...BOOKING, ...PERIOD }),
  BOOKING_CANCEL: PUSH_MESSAGES.BOOKING_CANCEL({ ...BOOKING, ...PERIOD }),
  BOOKING_REVERT_TO_DRAFT: PUSH_MESSAGES.BOOKING_REVERT_TO_DRAFT({
    ...BOOKING,
    ...PERIOD,
  }),
  BOOKING_EXTEND: PUSH_MESSAGES.BOOKING_EXTEND({ ...BOOKING, ...PERIOD }),
  BOOKING_SHORTEN: PUSH_MESSAGES.BOOKING_SHORTEN({ ...BOOKING, ...PERIOD }),
  BOOKING_DELETE: PUSH_MESSAGES.BOOKING_DELETE({ ...BOOKING, ...PERIOD }),
  BOOKING_UPDATE: PUSH_MESSAGES.BOOKING_UPDATE({ ...BOOKING, ...PERIOD }),
  BOOKING_CUSTODIAN_ASSIGNED: PUSH_MESSAGES.BOOKING_CUSTODIAN_ASSIGNED(BOOKING),
  BOOKING_CUSTODIAN_REMOVED: PUSH_MESSAGES.BOOKING_CUSTODIAN_REMOVED(BOOKING),
  AUDIT_ASSIGNED: PUSH_MESSAGES.AUDIT_ASSIGNED({
    ...AUDIT,
    dueDate: "05/10/2026, 09:00",
  }),
  AUDIT_REMINDER_24H: PUSH_MESSAGES.AUDIT_REMINDER_24H(AUDIT),
  AUDIT_REMINDER_4H: PUSH_MESSAGES.AUDIT_REMINDER_4H(AUDIT),
  AUDIT_REMINDER_1H: PUSH_MESSAGES.AUDIT_REMINDER_1H(AUDIT),
  AUDIT_OVERDUE: PUSH_MESSAGES.AUDIT_OVERDUE(AUDIT),
  ASSET_REMINDER: PUSH_MESSAGES.ASSET_REMINDER(ASSET_REMINDER),
} satisfies Record<PushEvent, unknown>;

/** The messages whose title names the booking or the audit. */
const NAMED_IN_TITLE = Object.entries(MESSAGES).filter(
  ([, { title }]) =>
    title.includes(BOOKING.bookingName) || title.includes(AUDIT.auditName)
);

describe("PUSH_MESSAGES", () => {
  it("has a message for every push event", () => {
    expect(Object.keys(PUSH_MESSAGES).sort()).toEqual(
      [
        "ASSET_REMINDER",
        "AUDIT_ASSIGNED",
        "AUDIT_OVERDUE",
        "AUDIT_REMINDER_1H",
        "AUDIT_REMINDER_24H",
        "AUDIT_REMINDER_4H",
        "BOOKING_CANCEL",
        "BOOKING_CHECKIN",
        "BOOKING_CHECKIN_REMINDER",
        "BOOKING_CHECKOUT_REMINDER",
        "BOOKING_CUSTODIAN_ASSIGNED",
        "BOOKING_CUSTODIAN_REMOVED",
        "BOOKING_DELETE",
        "BOOKING_EXTEND",
        "BOOKING_OVERDUE",
        "BOOKING_RESERVATION",
        "BOOKING_REVERT_TO_DRAFT",
        "BOOKING_SHORTEN",
        "BOOKING_UPDATE",
      ].sort()
    );
  });

  it.each(Object.entries(MESSAGES))(
    "%s opens a page in the event's workspace",
    (_event, message) => {
      expect(message.organizationId).toBe("org-1");
      expect(message.url).toMatch(/^\/[a-z]+(\/[\w-]+)*\?orgId=org-1$/);
    }
  );

  it.each(Object.entries(MESSAGES))(
    "%s titles without the email subject's site name",
    (_event, message) => {
      expect(message.title).not.toContain(" - shelf.nu");
      expect(message.title).not.toContain(" - Shelf");
    }
  );

  it("names the booking or audit in every title but the custodian removal and the asset reminder", () => {
    expect(NAMED_IN_TITLE.map(([event]) => event).sort()).toEqual(
      Object.keys(MESSAGES)
        .filter(
          (event) =>
            event !== "BOOKING_CUSTODIAN_REMOVED" && event !== "ASSET_REMINDER"
        )
        .sort()
    );
  });

  it.each(NAMED_IN_TITLE)(
    "%s leaves the name its title carries out of the body",
    (_event, { body }) => {
      expect(body).not.toContain(BOOKING.bookingName);
      expect(body).not.toContain(AUDIT.auditName);
    }
  );

  it("files each event under its domain's category", () => {
    expect(
      Object.entries(MESSAGES).map(([event, { category }]) => [event, category])
    ).toEqual(
      Object.keys(MESSAGES).map((event) => [
        event,
        event.startsWith("BOOKING_")
          ? "bookings"
          : event.startsWith("AUDIT_")
          ? "audits"
          : "stockAndReminders",
      ])
    );
  });

  it("gives a booking's dates in the body, and opens the booking", () => {
    expect(MESSAGES.BOOKING_RESERVATION).toEqual({
      organizationId: "org-1",
      category: "bookings",
      title: "✅ Booking reserved (Camera kit)",
      body: "01/10/2026, 10:00 to 03/10/2026, 17:00",
      url: "/bookings/booking-1?orgId=org-1",
    });
  });

  it("gives each reminder the one time it is about", () => {
    expect(
      [
        MESSAGES.BOOKING_CHECKOUT_REMINDER,
        MESSAGES.BOOKING_CHECKIN_REMINDER,
        MESSAGES.BOOKING_OVERDUE,
        MESSAGES.BOOKING_EXTEND,
      ].map(({ title, body }) => [title, body])
    ).toEqual([
      ["🔔 Checkout reminder (Camera kit)", "Checkout on 01/10/2026, 10:00"],
      ["🔔 Checkin reminder (Camera kit)", "Checkin on 03/10/2026, 17:00"],
      [
        "⚠️ Overdue booking (Camera kit)",
        "Checkin was due on 03/10/2026, 17:00",
      ],
      ["Booking extended (Camera kit)", "Now ends on 03/10/2026, 17:00"],
    ]);
  });

  it("opens the bookings list for a deleted booking, which has no page", () => {
    expect(MESSAGES.BOOKING_DELETE).toMatchObject({
      title: "🗑️ Booking deleted (Camera kit)",
      url: "/bookings?orgId=org-1",
    });
  });

  it("tells the custodian a booking update changed something to review", () => {
    expect(MESSAGES.BOOKING_UPDATE).toEqual({
      organizationId: "org-1",
      category: "bookings",
      title: "📝 Booking updated (Camera kit)",
      body: "Details changed. Tap to review.",
      url: "/bookings/booking-1?orgId=org-1",
    });
  });

  it("tells a new custodian they hold the booking, under the update title", () => {
    expect(MESSAGES.BOOKING_CUSTODIAN_ASSIGNED).toEqual({
      organizationId: "org-1",
      category: "bookings",
      title: MESSAGES.BOOKING_UPDATE.title,
      body: "You are now the custodian. Tap to review.",
      url: "/bookings/booking-1?orgId=org-1",
    });
  });

  it("tells a replaced custodian they were removed, and opens the bookings list", () => {
    expect(MESSAGES.BOOKING_CUSTODIAN_REMOVED).toEqual({
      organizationId: "org-1",
      category: "bookings",
      title: "You were removed from a booking",
      body: "Camera kit",
      url: "/bookings?orgId=org-1",
    });
  });

  it("gives an assignment its due date, or says there is none", () => {
    expect(MESSAGES.AUDIT_ASSIGNED).toEqual({
      organizationId: "org-1",
      category: "audits",
      title: `🔍 You've been assigned to audit: "Q4 count"`,
      body: "Due on 05/10/2026, 09:00",
      url: "/audits/audit-1/overview?orgId=org-1",
    });
    expect(
      PUSH_MESSAGES.AUDIT_ASSIGNED({ ...AUDIT, dueDate: undefined }).body
    ).toBe("No due date");
  });

  it("puts the time left in each audit reminder's title", () => {
    expect(
      [
        MESSAGES.AUDIT_REMINDER_24H,
        MESSAGES.AUDIT_REMINDER_4H,
        MESSAGES.AUDIT_REMINDER_1H,
        MESSAGES.AUDIT_OVERDUE,
      ].map(({ title, body }) => [title, body])
    ).toEqual([
      [`🔔 Audit due in 24 hours: "Q4 count"`, "Complete it before it's due."],
      [`🔔 Audit due in 4 hours: "Q4 count"`, "Complete it before it's due."],
      [`🔔 Audit due in 1 hour: "Q4 count"`, "Complete it before it's due."],
      [`⚠️ Audit overdue: "Q4 count"`, "Complete it as soon as possible."],
    ]);
  });

  it("names the reminder and its asset, and opens the asset", () => {
    expect(MESSAGES.ASSET_REMINDER).toEqual({
      organizationId: "org-1",
      category: "stockAndReminders",
      title: "⏰ Asset Reminder Notice",
      body: "Oil change (Forklift 3)",
      url: "/assets/asset-1?orgId=org-1",
    });
  });
});

describe("email subjects", () => {
  it("words every booking email subject", () => {
    expect(
      (
        [
          "RESERVATION",
          "CHECKOUT_REMINDER",
          "CHECKIN_REMINDER",
          "CHECKIN",
          "OVERDUE",
          "CANCEL",
          "REVERT_TO_DRAFT",
          "EXTEND",
          "SHORTEN",
          "DELETE",
          "UPDATE",
        ] as const
      ).map((eventType) => bookingEmailSubject(eventType, "Camera kit"))
    ).toEqual([
      "✅ Booking reserved (Camera kit) - shelf.nu",
      "🔔 Checkout reminder (Camera kit) - shelf.nu",
      "🔔 Checkin reminder (Camera kit) - shelf.nu",
      "🎉 Booking complete (Camera kit) - shelf.nu",
      "⚠️ Overdue booking (Camera kit) - shelf.nu",
      "❌ Booking cancelled (Camera kit) - shelf.nu",
      "↩️ Booking reverted to draft (Camera kit) - shelf.nu",
      "Booking extended (Camera kit) - shelf.nu",
      "Booking shortened (Camera kit) - shelf.nu",
      "🗑️ Booking deleted (Camera kit) - shelf.nu",
      "📝 Booking updated (Camera kit) - shelf.nu",
    ]);
  });

  it("words every audit email subject that has a push", () => {
    expect(
      (
        [
          "ASSIGNED",
          "REMINDER_24H",
          "REMINDER_4H",
          "REMINDER_1H",
          "OVERDUE",
        ] as const
      ).map((event) => auditEmailSubject(event, "Q4 count"))
    ).toEqual([
      `🔍 You've been assigned to audit: "Q4 count" - shelf.nu`,
      `🔔 Audit due in 24 hours: "Q4 count" - shelf.nu`,
      `🔔 Audit due in 4 hours: "Q4 count" - shelf.nu`,
      `🔔 Audit due in 1 hour: "Q4 count" - shelf.nu`,
      `⚠️ Audit overdue: "Q4 count" - shelf.nu`,
    ]);
  });

  it("titles each push with its email's subject, less the site name", () => {
    const pairs = [
      [
        MESSAGES.BOOKING_RESERVATION,
        bookingEmailSubject("RESERVATION", "Camera kit"),
      ],
      [MESSAGES.BOOKING_UPDATE, bookingEmailSubject("UPDATE", "Camera kit")],
      [
        MESSAGES.AUDIT_REMINDER_4H,
        auditEmailSubject("REMINDER_4H", "Q4 count"),
      ],
    ] as const;
    for (const [message, subject] of pairs) {
      expect(`${message.title} - shelf.nu`).toBe(subject);
    }
  });
});
