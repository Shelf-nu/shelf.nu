/**
 * Regression tests for reminder wall-clock ↔ UTC round-trip.
 *
 * Confirms the edit-reminder action parses the submitted wall-clock time in the
 * acting user's RESOLVED timezone preference (the same zone the UI displays
 * dates in) rather than the BROWSER hint, and that the recurrence end date
 * (stored as end-of-day in the reminder's zone) round-trips through the edit
 * dialog without drifting.
 *
 * @see {@link file://./utils.server.ts} resolveRemindersActions — code under test
 */
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as ClientHintsModule from "~/utils/client-hints";

// why: avoid DB / scheduler side-effects — we only assert the parsed instant
// that the action hands to the service layer.
const editAssetReminder = vi.fn();
const deleteAssetReminder = vi.fn();
vi.mock("./service.server", () => ({
  editAssetReminder: (args: unknown) => editAssetReminder(args),
  deleteAssetReminder: (args: unknown) => deleteAssetReminder(args),
}));

// why: control the acting user's RESOLVED pref timezone independently of the
// browser hint, so the test proves the parse uses the pref zone (not browser).
const resolveUserFormatPrefsById = vi.fn();
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: (...args: unknown[]) =>
    resolveUserFormatPrefsById(...args),
}));

// why: simulate a browser in a DIFFERENT timezone (UTC+3) than the user's pref.
// The OLD behavior read this hint to parse, which would produce the wrong UTC
// instant and fail the assertion below; the fix ignores it for the timezone.
vi.mock("~/utils/client-hints", async (importOriginal) => {
  const actual = await importOriginal<typeof ClientHintsModule>();
  const browserHint = { locale: "en-US", timeZone: "Etc/GMT-3" }; // UTC+3
  return {
    ...actual,
    getClientHint: () => browserHint,
    getHints: () => browserHint,
  };
});

// why: notification dispatch is an unrelated side-effect.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the edit action reads the workspace tier (a DB lookup) to decide
// whether recurrence edits are allowed; these tests only cover date parsing.
vi.mock("../tier/service.server", () => ({
  getOrganizationTierLimit: vi.fn().mockResolvedValue({
    canUseRecurringReminders: true,
  }),
}));

import { resolveRecurrenceZone } from "./recurrence";
import {
  resolveReminderPayloadDates,
  resolveRemindersActions,
} from "./utils.server";

/** The fields of a thrown ShelfError these tests read. */
type ShelfErrorLike = {
  status?: number;
  additionalData: {
    validationErrors: Record<string, { message: string }>;
  };
};

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

/** Mirrors the dialog's endsAtDefault computation exactly. */
function dialogEndsAtDefault(endsAt: Date, timezone: string | null): string {
  return DateTime.fromJSDate(endsAt)
    .setZone(resolveRecurrenceZone(timezone))
    .toFormat("yyyy-MM-dd");
}

/** Builds a valid edit-reminder POST request with the given wall-clock string. */
function buildEditRequest(alertDateTime: string): Request {
  const formData = new FormData();
  formData.append("intent", "edit-reminder");
  formData.append("id", "reminder-1");
  formData.append("name", "Battery check");
  formData.append("message", "Check the battery");
  formData.append("alertDateTime", alertDateTime);
  formData.append("teamMembers[0]", "tm-1");
  formData.append("redirectTo", "/assets/asset-1/reminders");

  return new Request("http://localhost/assets/asset-1/reminders", {
    method: "POST",
    body: formData,
  });
}

describe("resolveRemindersActions — alertDateTime timezone round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses the wall-clock in the user's pref timezone (Europe/London), not the browser's", async () => {
    // User pref = Europe/London. In July this is BST (UTC+1).
    resolveUserFormatPrefsById.mockResolvedValue({
      dateFormat: "dd/MM/yyyy",
      timeFormat: "24",
      weekStart: 1,
      timeZone: "Europe/London",
    });

    await resolveRemindersActions({
      request: buildEditRequest("2027-07-20T15:48"),
      organizationId: "org-1",
      organizations: [],
      userId: "user-1",
    });

    // The pref zone must be resolved for the ACTING user.
    expect(resolveUserFormatPrefsById).toHaveBeenCalledWith(
      "user-1",
      expect.anything()
    );

    expect(editAssetReminder).toHaveBeenCalledTimes(1);
    const { alertDateTime } = editAssetReminder.mock.calls[0][0] as {
      alertDateTime: Date;
    };

    // 15:48 London wall-clock in July (BST, UTC+1) → 14:48 UTC.
    expect(alertDateTime.toISOString()).toBe("2027-07-20T14:48:00.000Z");

    // Guard against the OLD bug: the browser hint (UTC+3) would have stored
    // 12:48 UTC. If this ever passes, the parse is using the browser zone again.
    expect(alertDateTime.toISOString()).not.toBe("2027-07-20T12:48:00.000Z");
  });
});

describe("resolveReminderPayloadDates end-date round-trip", () => {
  it("does not drift across edit cycles for a west-of-UTC workspace", () => {
    const zone = "America/New_York"; // UTC-4/-5

    // STORE: user picks 2099-07-15 as the end date
    const first = resolveReminderPayloadDates({
      timeZone: zone,
      formData: formData({
        alertDateTime: "2099-07-10T09:00",
        endsAt: "2099-07-15",
      }),
      repeat: "monthly",
    });
    const storedEndsAt = first.recurrence!.endsAt!;

    // DISPLAY: the dialog renders the calendar date back in the stored zone
    const shownDate = dialogEndsAtDefault(storedEndsAt, zone);
    expect(shownDate).toBe("2099-07-15"); // NOT 2099-07-16

    // RE-SUBMIT unchanged: the parsed instant must equal the stored one
    const second = resolveReminderPayloadDates({
      timeZone: zone,
      formData: formData({
        alertDateTime: "2099-07-10T09:00",
        endsAt: shownDate,
      }),
      repeat: "monthly",
    });
    expect(second.recurrence!.endsAt!.getTime()).toBe(storedEndsAt.getTime());
  });

  it("stores the end date as end-of-day in the workspace zone", () => {
    const { recurrence } = resolveReminderPayloadDates({
      timeZone: "America/New_York",
      formData: formData({
        alertDateTime: "2099-07-10T09:00",
        endsAt: "2099-07-15",
      }),
      repeat: "weekly",
    });
    // 2099-07-15 23:59:59.999 in New York (EDT, -04:00) = 2099-07-16T03:59:59.999Z
    expect(recurrence!.endsAt!.toISOString()).toBe("2099-07-16T03:59:59.999Z");
  });

  it("rejects a past alertDateTime against the RESOLVED instant (field-level 400)", () => {
    let thrown: ShelfErrorLike | null = null;
    try {
      resolveReminderPayloadDates({
        timeZone: "America/New_York",
        formData: formData({ alertDateTime: "2020-01-01T09:00" }),
        repeat: "never",
      });
    } catch (e) {
      thrown = e as ShelfErrorLike;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.status).toBe(400);
    expect(thrown?.additionalData.validationErrors.alertDateTime.message).toBe(
      "Please select a date in the future"
    );
  });

  it("rejects an end date before the reminder on the RESOLVED instants (field-level 400)", () => {
    let thrown: ShelfErrorLike | null = null;
    try {
      resolveReminderPayloadDates({
        timeZone: "America/New_York",
        formData: formData({
          alertDateTime: "2099-07-10T09:00",
          endsAt: "2099-07-01",
        }),
        repeat: "monthly",
      });
    } catch (e) {
      thrown = e as ShelfErrorLike;
    }
    expect(thrown?.status).toBe(400);
    expect(thrown?.additionalData.validationErrors.endsAt.message).toBe(
      "End date must be on or after the reminder date"
    );
  });

  it("accepts a same-day end date with a late-evening reminder for west-of-UTC users", () => {
    // 23:30 New York on July 15 = 03:30Z July 16; end-of-day NY July 15 =
    // 03:59:59.999Z July 16 — same-day is valid and must not be rejected.
    const { recurrence } = resolveReminderPayloadDates({
      timeZone: "America/New_York",
      formData: formData({
        alertDateTime: "2099-07-15T23:30",
        endsAt: "2099-07-15",
      }),
      repeat: "weekly",
    });
    expect(recurrence!.endsAt!.toISOString()).toBe("2099-07-16T03:59:59.999Z");
  });

  it("returns null recurrence for a one-shot (repeat = never)", () => {
    const { recurrence } = resolveReminderPayloadDates({
      timeZone: "UTC",
      formData: formData({ alertDateTime: "2099-07-10T09:00" }),
      repeat: "never",
    });
    expect(recurrence).toBeNull();
  });

  it("captures the workspace timezone on the recurrence payload", () => {
    const { recurrence } = resolveReminderPayloadDates({
      timeZone: "Europe/Berlin",
      formData: formData({ alertDateTime: "2099-07-10T09:00" }),
      repeat: "quarterly",
    });
    expect(recurrence!.timezone).toBe("Europe/Berlin");
    expect(recurrence!.endsAt).toBeNull();
  });
});
