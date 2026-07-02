// @vitest-environment node
/**
 * Parse-level tests for the reminder form schemas. These cover the two
 * multipart-form traps that would otherwise break the flows silently:
 * an empty optional date input submits "" (not undefined), and a disabled
 * Repeat select submits nothing at all.
 */
import {
  editReminderSchema,
  setReminderSchema,
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

  it("rejects an end date before the reminder date", () => {
    const result = setReminderSchema.safeParse(
      basePayload({ repeat: "monthly", endsAt: "2099-07-01" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["endsAt"]);
    }
  });

  it("rejects a past alertDateTime at PARSE time (not module-load time)", () => {
    const result = setReminderSchema.safeParse(
      basePayload({ alertDateTime: "2020-01-01T09:00" })
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["alertDateTime"]);
    }
  });

  it("ignores endsAt ordering when repeat is never", () => {
    expect(() =>
      setReminderSchema.parse(basePayload({ endsAt: "2000-01-01" }))
    ).not.toThrow();
  });
});

describe("editReminderSchema", () => {
  it("requires the reminder id and keeps the shared refinements", () => {
    const parsed = editReminderSchema.parse(
      basePayload({ id: "reminder-1", repeat: "yearly" })
    );
    expect(parsed.id).toBe("reminder-1");
    expect(parsed.repeat).toBe("yearly");

    expect(
      editReminderSchema.safeParse(basePayload({ repeat: "yearly" })).success
    ).toBe(false);
  });
});
