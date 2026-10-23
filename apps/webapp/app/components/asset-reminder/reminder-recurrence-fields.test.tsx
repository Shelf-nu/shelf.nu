/**
 * Tests for the Repeat control on a plan without recurring reminders: what the
 * locked control submits, so a downgraded workspace can keep or stop a series
 * but never start or change one.
 *
 * @see {@link file://./reminder-recurrence-fields.tsx}
 */
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import ReminderRecurrenceFields from "./reminder-recurrence-fields";

type Props = ComponentProps<typeof ReminderRecurrenceFields>;

/** Renders the fields locked (plan without recurrence) inside a form. */
function renderLocked(overrides: Partial<Props> = {}) {
  const props: Props = {
    canUseRecurringReminders: false,
    disabled: false,
    repeat: "monthly",
    onRepeatChange: () => {},
    initialRepeat: "monthly",
    endsAtDefault: "2099-12-31",
    repeatFieldName: "repeat",
    endsAtFieldName: "endsAt",
    ...overrides,
  };
  const { container } = render(
    <MemoryRouter>
      <form>
        <ReminderRecurrenceFields {...props} />
      </form>
    </MemoryRouter>
  );
  return new FormData(container.querySelector("form")!);
}

describe("ReminderRecurrenceFields on a plan without recurrence", () => {
  it("keeps the stored cadence and end date on a plain edit", () => {
    const form = renderLocked();

    expect(form.get("repeat")).toBe("monthly");
    expect(form.get("endsAt")).toBe("2099-12-31");
  });

  it("leaves the Repeat control usable so the series can be turned off", () => {
    renderLocked();

    expect(screen.getByRole("combobox")).not.toBeDisabled();
  });

  it("locks the Repeat control for a one-time reminder", () => {
    renderLocked({ repeat: "never", initialRepeat: "never" });

    expect(screen.getByRole("combobox")).toBeDisabled();
  });

  it("submits Never without the stored end date once repeat is turned off", () => {
    const form = renderLocked({ repeat: "never" });

    expect(form.get("repeat")).toBe("never");
    expect(form.get("endsAt")).toBeNull();
  });

  it("submits Never for a one-time reminder", () => {
    const form = renderLocked({
      repeat: "never",
      initialRepeat: "never",
      endsAtDefault: undefined,
    });

    expect(form.get("repeat")).toBe("never");
  });
});
