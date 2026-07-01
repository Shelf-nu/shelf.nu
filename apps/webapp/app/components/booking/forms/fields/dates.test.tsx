/**
 * Regression tests for {@link DatesFields} — start/end date input binding.
 *
 * Guards the fix for the duplicate → redirect bug: when React Router reuses the
 * booking edit form instance across a client-side navigation between two
 * bookings, the parent re-renders `DatesFields` with a new `startDate` prop
 * WITHOUT remounting. The Start Date input must be CONTROLLED (like End Date)
 * so it reflects the new value instead of stranding the previously-rendered
 * booking's start date until a full page refresh.
 *
 * @see {@link file://./dates.tsx}
 * @see {@link file://../edit-booking-form.tsx} (the startDate/endDate re-sync)
 */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DatesFields } from "./dates";

// why: DatesFields reads workspace booking settings from the _layout route
// loader via this hook; there's no router in a unit test, so stub it.
vi.mock("~/hooks/use-booking-settings", () => ({
  useBookingSettings: () => ({ maxBookingLength: null, bufferStartTime: 0 }),
}));

/** Minimal props for DatesFields; per-test overrides applied on top. */
function baseProps() {
  return {
    startDateName: "startDate",
    endDateName: "endDate",
    setStartDate: vi.fn(),
    setEndDate: vi.fn(),
    disabled: false,
    isNewBooking: false as boolean | undefined,
    // workingHours=null → WorkingHoursInfo renders nothing (no preview dialog).
    workingHoursData: {
      workingHours: null,
      isLoading: false,
      error: undefined,
    },
  };
}

function startInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[name="startDate"]');
}
function endInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>('input[name="endDate"]');
}

describe("DatesFields", () => {
  it("renders the provided start and end dates", () => {
    const { container } = render(
      <DatesFields
        {...baseProps()}
        startDate="2026-06-23T14:34"
        endDate="2026-07-01T18:00"
      />
    );

    expect(startInput(container)?.value).toBe("2026-06-23T14:34");
    expect(endInput(container)?.value).toBe("2026-07-01T18:00");
  });

  it("reflects a new startDate prop on re-render WITHOUT remounting (controlled input)", () => {
    // This is the regression: an uncontrolled `defaultValue` would keep the
    // original value ("2026-06-23T14:34") after a prop change, which is exactly
    // the stale start date users saw after duplicating a booking.
    const { container, rerender } = render(
      <DatesFields
        {...baseProps()}
        startDate="2026-06-23T14:34"
        endDate="2026-07-01T18:00"
      />
    );

    expect(startInput(container)?.value).toBe("2026-06-23T14:34");

    // Simulate the parent (edit form) re-rendering with the newly-navigated
    // booking's dates — same component instance, no key/remount here.
    rerender(
      <DatesFields
        {...baseProps()}
        startDate="2026-07-01T14:43"
        endDate="2026-07-01T18:00"
      />
    );

    expect(startInput(container)?.value).toBe("2026-07-01T14:43");
    // End date already behaved correctly (controlled) — assert it stays in sync too.
    expect(endInput(container)?.value).toBe("2026-07-01T18:00");
  });
});
