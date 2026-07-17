/**
 * Regression tests for reminder wall-clock ↔ UTC round-trip.
 *
 * Confirms the edit-reminder action parses the submitted wall-clock time in the
 * acting user's RESOLVED timezone preference (the same zone the UI displays
 * dates in) rather than the BROWSER hint. When the two differ, using the browser
 * zone offsets the stored UTC instant wrong — the confirmed timezone bug.
 *
 * @see {@link file://./utils.server.ts} resolveRemindersActions — code under test
 */
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

import { resolveRemindersActions } from "./utils.server";

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
