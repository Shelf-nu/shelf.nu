// @vitest-environment node
/**
 * Parse-level tests for the reminder form schemas. These cover the two
 * multipart-form traps that would otherwise break the flows silently:
 * an empty optional date input submits "" (not undefined), and a disabled
 * Repeat select submits nothing at all.
 */
import {
  editReminderServerSchema,
  setReminderSchema,
  setReminderServerSchema,
} from "./set-or-edit-reminder-dialog";

const FUTURE = "2099-07-15T09:00";

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Service the generator",
    message: "Change oil and filters",
    alertDateTime: FUTURE,
    teamMembers: ["tm-1"],
    ...overrides,
  };
}

describe("setReminderSchema", () => {
  it("defaults repeat to never when the field is absent (disabled/locked select)", () => {
    const parsed = setReminderSchema.parse(basePayload());
    expect(parsed.repeat).toBe("never");
    expect(parsed.endsAt).toBeUndefined();
  });

  it('treats an empty "Ends on" input ("") as no end date', () => {
    const parsed = setReminderSchema.parse(
      basePayload({ repeat: "monthly", endsAt: "" })
    );
    expect(parsed.repeat).toBe("monthly");
    expect(parsed.endsAt).toBeUndefined();
  });

  it("accepts a recurring payload with an end date after the reminder date", () => {
    const parsed = setReminderSchema.parse(
      basePayload({ repeat: "quarterly", endsAt: "2099-12-31" })
    );
    expect(parsed.endsAt).toBeInstanceOf(Date);
  });

  it("accepts a SAME-DAY end date (interpreted as end-of-day server-side)", () => {
    expect(() =>
      setReminderSchema.parse(
        basePayload({ repeat: "weekly", endsAt: "2099-07-15" })
      )
    ).not.toThrow();
  });

  it("rejects an end date on an earlier CALENDAR DAY than the reminder (client)", () => {
    const result = setReminderSchema.safeParse(
      basePayload({ repeat: "monthly", endsAt: "2099-07-01" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["endsAt"]);
    }
  });

  it("accepts a same-day end date with a LATE-evening reminder time (calendar compare, not instant compare)", () => {
    // The old instant-based check (endsAt UTC-midnight + 24h vs local
    // datetime) rejected this shape for users west of UTC.
    expect(() =>
      setReminderSchema.parse(
        basePayload({
          repeat: "weekly",
          alertDateTime: "2099-07-15T23:30",
          endsAt: "2099-07-15",
        })
      )
    ).not.toThrow();
  });

  it("rejects a past alertDateTime at PARSE time on the CLIENT schema", () => {
    const result = setReminderSchema.safeParse(
      basePayload({ alertDateTime: "2020-01-01T09:00" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["alertDateTime"]);
    }
  });

  it("runs NO date refinements on the SERVER schemas (zone-resolved checks happen in resolveReminderPayloadDates)", () => {
    // Server-side, z.coerce.date() reads raw strings in the process zone, so
    // both the future check and the endsAt ordering check would misfire for
    // users in other zones. Both run on the resolved instants instead.
    expect(
      setReminderServerSchema.safeParse(
        basePayload({ alertDateTime: "2020-01-01T09:00" })
      ).success
    ).toBe(true);
    expect(
      setReminderServerSchema.safeParse(
        basePayload({ repeat: "monthly", endsAt: "2099-07-01" })
      ).success
    ).toBe(true);
  });

  it("ignores endsAt ordering when repeat is never", () => {
    expect(() =>
      setReminderSchema.parse(basePayload({ endsAt: "2000-01-01" }))
    ).not.toThrow();
  });
});

describe("editReminderServerSchema", () => {
  it("requires the reminder id", () => {
    const parsed = editReminderServerSchema.parse(
      basePayload({ id: "reminder-1", repeat: "yearly" })
    );
    expect(parsed.id).toBe("reminder-1");
    expect(parsed.repeat).toBe("yearly");

    expect(
      editReminderServerSchema.safeParse(basePayload({ repeat: "yearly" }))
        .success
    ).toBe(false);
  });
});
