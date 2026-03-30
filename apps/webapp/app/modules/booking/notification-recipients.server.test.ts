import type { BookingForEmail } from "~/emails/types";
import { getBookingNotificationSettingsForOrg } from "~/modules/booking-settings/service.server";
import { getOrganizationAdminsForNotification } from "~/modules/organization/service.server";

import { getBookingNotificationRecipients } from "./notification-recipients.server";

// @vitest-environment node
// see https://vitest.dev/guide/environment.html#environments-for-specific-files

// why: external database call
vitest.mock("~/modules/booking-settings/service.server", () => ({
  getBookingNotificationSettingsForOrg: vitest.fn(),
}));

// why: external database call
vitest.mock("~/modules/organization/service.server", () => ({
  getOrganizationAdminsForNotification: vitest.fn(),
}));

const mockedGetSettings = vitest.mocked(getBookingNotificationSettingsForOrg);
const mockedGetAdmins = vitest.mocked(getOrganizationAdminsForNotification);

/** Helper to build a mock booking that satisfies BookingForEmail shape */
function buildMockBooking(
  overrides: Partial<{
    custodianUser: BookingForEmail["custodianUser"];
    creator: BookingForEmail["creator"];
    notificationRecipients: BookingForEmail["notificationRecipients"];
  }> = {}
): BookingForEmail {
  return {
    id: "booking-1",
    name: "Test Booking",
    from: new Date("2026-04-01T10:00:00Z"),
    to: new Date("2026-04-02T10:00:00Z"),
    status: "RESERVED",
    organizationId: "org-1",
    custodianUser: overrides.custodianUser ?? {
      id: "custodian-user-1",
      email: "custodian@example.com",
      firstName: "Alice",
      lastName: "Custodian",
      createdAt: new Date(),
      updatedAt: new Date(),
      username: "alice",
      profilePicture: null,
      onboarded: true,
      sso: false,
      tierId: null,
    },
    custodianTeamMember: null,
    creator: overrides.creator ?? {
      id: "creator-user-1",
      email: "creator@example.com",
      firstName: "Bob",
      lastName: "Creator",
    },
    notificationRecipients: overrides.notificationRecipients ?? [],
    organization: {
      id: "org-1",
      name: "Test Org",
      customEmailFooter: null,
      type: "PERSONAL",
      userId: "owner-1",
      currency: "USD",
      updatedAt: new Date(),
      createdAt: new Date(),
      imageId: null,
      enabledSso: false,
      selfServiceGroupId: null,
      owner: { email: "owner@example.com" },
    },
    _count: { assets: 3 },
  } as unknown as BookingForEmail;
}

/** Default mock settings with everything turned off */
function defaultSettings() {
  return {
    notifyBookingCreator: false,
    notifyAdminsOnNewBooking: false,
    alwaysNotifyTeamMembers: [] as Array<{
      id: string;
      name: string;
      user: {
        id: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        profilePicture: string | null;
      };
    }>,
  };
}

describe("getBookingNotificationRecipients", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    mockedGetSettings.mockResolvedValue(defaultSettings());
    mockedGetAdmins.mockResolvedValue([]);
  });

  it("always includes the custodian", async () => {
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CHECKIN",
      organizationId: "org-1",
    });

    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toMatchObject({
      email: "custodian@example.com",
      reason: "custodian",
    });
  });

  it("includes creator when notifyBookingCreator is true", async () => {
    mockedGetSettings.mockResolvedValue({
      ...defaultSettings(),
      notifyBookingCreator: true,
    });
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CHECKIN",
      organizationId: "org-1",
    });

    expect(recipients).toHaveLength(2);
    const emails = recipients.map((r) => r.email);
    expect(emails).toContain("custodian@example.com");
    expect(emails).toContain("creator@example.com");
    expect(
      recipients.find((r) => r.email === "creator@example.com")?.reason
    ).toBe("creator");
  });

  it("excludes creator when notifyBookingCreator is false", async () => {
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CHECKIN",
      organizationId: "org-1",
    });

    const emails = recipients.map((r) => r.email);
    expect(emails).not.toContain("creator@example.com");
  });

  it("includes admins only for RESERVATION event type", async () => {
    mockedGetSettings.mockResolvedValue({
      ...defaultSettings(),
      notifyAdminsOnNewBooking: true,
    });
    mockedGetAdmins.mockResolvedValue([
      {
        id: "admin-1",
        email: "admin1@example.com",
        firstName: "Admin",
        lastName: "One",
      },
      {
        id: "admin-2",
        email: "admin2@example.com",
        firstName: "Admin",
        lastName: "Two",
      },
    ]);
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "RESERVATION",
      organizationId: "org-1",
      isSelfServiceOrBase: true,
    });

    const adminRecipients = recipients.filter((r) => r.reason === "admin");
    expect(adminRecipients).toHaveLength(2);
    expect(adminRecipients.map((r) => r.email)).toEqual(
      expect.arrayContaining(["admin1@example.com", "admin2@example.com"])
    );
  });

  it("excludes admins for non-RESERVATION event types", async () => {
    mockedGetSettings.mockResolvedValue({
      ...defaultSettings(),
      notifyAdminsOnNewBooking: true,
    });
    mockedGetAdmins.mockResolvedValue([
      {
        id: "admin-1",
        email: "admin@example.com",
        firstName: "Admin",
        lastName: "User",
      },
    ]);
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CHECKIN",
      organizationId: "org-1",
    });

    expect(mockedGetAdmins).not.toHaveBeenCalled();
    const adminRecipients = recipients.filter((r) => r.reason === "admin");
    expect(adminRecipients).toHaveLength(0);
  });

  it("excludes admins for RESERVATION when custodian is admin (not self-service)", async () => {
    mockedGetSettings.mockResolvedValue({
      ...defaultSettings(),
      notifyAdminsOnNewBooking: true,
    });
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "RESERVATION",
      organizationId: "org-1",
      isSelfServiceOrBase: false,
    });

    expect(mockedGetAdmins).not.toHaveBeenCalled();
    const adminRecipients = recipients.filter((r) => r.reason === "admin");
    expect(adminRecipients).toHaveLength(0);
  });

  it("includes always-notify users for all event types", async () => {
    mockedGetSettings.mockResolvedValue({
      ...defaultSettings(),
      alwaysNotifyTeamMembers: [
        {
          id: "tm-always-1",
          name: "Always One",
          user: {
            id: "always-1",
            email: "always1@example.com",
            firstName: "Always",
            lastName: "One",
            profilePicture: null,
          },
        },
        {
          id: "tm-always-2",
          name: "Always Two",
          user: {
            id: "always-2",
            email: "always2@example.com",
            firstName: "Always",
            lastName: "Two",
            profilePicture: null,
          },
        },
      ],
    });
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CANCEL",
      organizationId: "org-1",
    });

    const alwaysRecipients = recipients.filter(
      (r) => r.reason === "always_notify"
    );
    expect(alwaysRecipients).toHaveLength(2);
    expect(alwaysRecipients.map((r) => r.email)).toEqual(
      expect.arrayContaining(["always1@example.com", "always2@example.com"])
    );
  });

  it("includes per-booking notification recipients", async () => {
    const booking = buildMockBooking({
      notificationRecipients: [
        {
          id: "tm-notif-1",
          name: "Notif User",
          user: {
            id: "notif-user-1",
            email: "booking-notif@example.com",
            firstName: "Notif",
            lastName: "User",
          },
        },
      ],
    });

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "OVERDUE",
      organizationId: "org-1",
    });

    const bookingRecipients = recipients.filter(
      (r) => r.reason === "booking_recipient"
    );
    expect(bookingRecipients).toHaveLength(1);
    expect(bookingRecipients[0].email).toBe("booking-notif@example.com");
  });

  it("deduplicates recipients by email, first entry wins", async () => {
    mockedGetSettings.mockResolvedValue({
      ...defaultSettings(),
      alwaysNotifyTeamMembers: [
        {
          id: "tm-always-dup",
          name: "Duplicate User",
          user: {
            id: "always-dup",
            email: "custodian@example.com",
            firstName: "Duplicate",
            lastName: "User",
            profilePicture: null,
          },
        },
      ],
    });
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CHECKIN",
      organizationId: "org-1",
    });

    const matchingRecipients = recipients.filter(
      (r) => r.email === "custodian@example.com"
    );
    expect(matchingRecipients).toHaveLength(1);
    expect(matchingRecipients[0].reason).toBe("custodian");
  });

  it("excludes editor from non-scheduled notifications (but preserves custodian and creator)", async () => {
    // Editor exclusion should remove always-notify and per-booking recipients
    // but NOT the custodian or creator — they always receive emails
    mockedGetSettings.mockResolvedValue({
      ...defaultSettings(),
      alwaysNotifyTeamMembers: [
        {
          id: "tm-editor",
          name: "Editor User",
          user: {
            id: "editor-user-1",
            email: "editor@example.com",
            firstName: "Editor",
            lastName: "User",
            profilePicture: null,
          },
        },
      ],
    });
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CHECKIN",
      organizationId: "org-1",
      editorUserId: "editor-user-1",
      isScheduledJob: false,
    });

    const emails = recipients.map((r) => r.email);
    // Editor (always-notify) should be excluded
    expect(emails).not.toContain("editor@example.com");
    // Custodian should still be present even if they were the editor
    expect(emails).toContain("custodian@example.com");
  });

  it("does not exclude editor for scheduled jobs", async () => {
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CHECKIN",
      organizationId: "org-1",
      editorUserId: "custodian-user-1",
      isScheduledJob: true,
    });

    const emails = recipients.map((r) => r.email);
    expect(emails).toContain("custodian@example.com");
  });

  it("filters out recipients with empty emails", async () => {
    mockedGetSettings.mockResolvedValue({
      ...defaultSettings(),
      alwaysNotifyTeamMembers: [
        {
          id: "tm-no-email",
          name: "No Email",
          user: {
            id: "no-email",
            email: "",
            firstName: "No",
            lastName: "Email",
            profilePicture: null,
          },
        },
      ],
    });
    const booking = buildMockBooking();

    const recipients = await getBookingNotificationRecipients({
      booking,
      eventType: "CHECKIN",
      organizationId: "org-1",
    });

    const emptyEmailRecipients = recipients.filter(
      (r) => r.email === "" || !r.email
    );
    expect(emptyEmailRecipients).toHaveLength(0);
  });
});
