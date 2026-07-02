// @vitest-environment node
/**
 * Round-trip regression for the recurrence end-date timezone handling.
 *
 * recurrenceEndsAt is stored as END-OF-DAY in the reminder's own timezone.
 * The edit dialog must render the calendar date back in THAT zone (not UTC),
 * otherwise west-of-UTC workspaces see the date +1 day and it drifts on every
 * save. This test drives the real server parser + the exact formatting the
 * dialog uses and asserts the stored instant is stable across edit cycles.
 */
import { DateTime } from "luxon";
import { resolveRecurrenceZone } from "./recurrence";
import { resolveReminderPayloadDates } from "./utils.server";

// why: resolveReminderPayloadDates is pure, but importing utils.server pulls
// in the service module graph (service.server -> db.server) which would
// otherwise instantiate a real Prisma connection attempt during import
vitest.mock("~/database/db.server", () => ({ db: {} }));

function requestWithZone(timeZone: string): Request {
  return new Request("https://app.shelf.nu/assets/a/reminders", {
    headers: { Cookie: `CH-time-zone=${timeZone}` },
  });
}

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

describe("resolveReminderPayloadDates end-date round-trip", () => {
  it("does not drift across edit cycles for a west-of-UTC workspace", () => {
    const zone = "America/New_York"; // UTC-4/-5

    // STORE: user picks 2026-07-15 as the end date
    const first = resolveReminderPayloadDates({
      request: requestWithZone(zone),
      formData: formData({
        alertDateTime: "2026-07-10T09:00",
        endsAt: "2026-07-15",
      }),
      repeat: "monthly",
    });
    const storedEndsAt = first.recurrence!.endsAt!;

    // DISPLAY: the dialog renders the calendar date back in the stored zone
    const shownDate = dialogEndsAtDefault(storedEndsAt, zone);
    expect(shownDate).toBe("2026-07-15"); // NOT 2026-07-16

    // RE-SUBMIT unchanged: the parsed instant must equal the stored one
    const second = resolveReminderPayloadDates({
      request: requestWithZone(zone),
      formData: formData({
        alertDateTime: "2026-07-10T09:00",
        endsAt: shownDate,
      }),
      repeat: "monthly",
    });
    expect(second.recurrence!.endsAt!.getTime()).toBe(storedEndsAt.getTime());
  });

  it("stores the end date as end-of-day in the workspace zone", () => {
    const { recurrence } = resolveReminderPayloadDates({
      request: requestWithZone("America/New_York"),
      formData: formData({
        alertDateTime: "2026-07-10T09:00",
        endsAt: "2026-07-15",
      }),
      repeat: "weekly",
    });
    // 2026-07-15 23:59:59.999 in New York (EDT, -04:00) = 2026-07-16T03:59:59.999Z
    expect(recurrence!.endsAt!.toISOString()).toBe("2026-07-16T03:59:59.999Z");
  });

  it("returns null recurrence for a one-shot (repeat = never)", () => {
    const { recurrence } = resolveReminderPayloadDates({
      request: requestWithZone("UTC"),
      formData: formData({ alertDateTime: "2026-07-10T09:00" }),
      repeat: "never",
    });
    expect(recurrence).toBeNull();
  });

  it("captures the workspace timezone on the recurrence payload", () => {
    const { recurrence } = resolveReminderPayloadDates({
      request: requestWithZone("Europe/Berlin"),
      formData: formData({ alertDateTime: "2026-07-10T09:00" }),
      repeat: "quarterly",
    });
    expect(recurrence!.timezone).toBe("Europe/Berlin");
    expect(recurrence!.endsAt).toBeNull();
  });
});
