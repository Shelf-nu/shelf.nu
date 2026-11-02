/**
 * Tests for {@link ExtendBookingDialog}: it addresses the booking by its own
 * id, so it works from any page, and it loads the extend horizon itself only
 * when the caller did not pass one.
 *
 * @see {@link file://./extend-booking-dialog.tsx}
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ExtendBookingDialog from "./extend-booking-dialog";

const load = vi.fn();

// why: the real `useFetcher` needs a data router, which a component test does
// not mount; `load` is what is asserted and `Form` becomes a plain form.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useNavigation: () => ({ state: "idle" }),
    useFetcher: () => ({
      state: "idle",
      data: undefined,
      load,
      Form: ({ children, ...rest }: { children: ReactNode }) => (
        <form {...rest}>{children}</form>
      ),
    }),
  };
});

// why: these hooks read the route loaders and organization context a
// component test does not mount.
vi.mock("~/hooks/use-format-prefs", () => ({
  useFormatPrefs: () => ({
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  }),
}));
vi.mock("~/hooks/use-working-hours", () => ({
  useWorkingHours: () => ({ workingHours: undefined, isLoading: false }),
}));
vi.mock("~/hooks/use-booking-settings", () => ({
  useBookingSettings: () => ({}),
}));
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ policy: { bookings: { bypassTimeLimits: true } } }),
}));
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    formatDate: (d: string) => d,
    formatDateTime: (d: string | Date) => String(d),
  }),
}));

// why: the real dialog portals its content; a plain shell lets `open` drive
// visibility.
vi.mock("../layout/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// why: the real picker is a heavy widget; a named input carries the value the
// form would post.
vi.mock("../shared/date-time-picker", () => ({
  DateTimePicker: ({
    name,
    defaultValue,
  }: {
    name: string;
    defaultValue: string;
  }) => <input name={name} defaultValue={defaultValue} />,
}));

const booking = {
  id: "b1",
  from: new Date("2026-11-01T09:00:00.000Z"),
  to: new Date("2026-11-03T17:00:00.000Z"),
};
const horizonValue = { horizon: null, byAssetId: {}, byKitId: {} };

describe("ExtendBookingDialog", () => {
  beforeEach(() => load.mockClear());

  it("posts extend-booking with startDate and endDate to /bookings/b1/overview", () => {
    render(
      <ExtendBookingDialog booking={booking} nextReservations={horizonValue} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Change end date" }));

    const form = screen
      .getByRole("button", { name: "Submit" })
      .closest("form")!;
    expect(form.getAttribute("action")).toBe("/bookings/b1/overview");
    expect(form.querySelector('[name="intent"]')?.getAttribute("value")).toBe(
      "extend-booking"
    );
    expect(
      form.querySelector('[name="startDate"]')?.getAttribute("value")
    ).toBe(booking.from.toISOString());
    expect(form.querySelector('[name="endDate"]')).not.toBeNull();
  });

  it("fetches /api/bookings/b1/next-reservations on open when no horizon is passed", () => {
    render(<ExtendBookingDialog booking={booking} />);
    expect(load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Change end date" }));

    expect(load).toHaveBeenCalledWith("/api/bookings/b1/next-reservations");
  });

  it("does not fetch when nextReservations is passed", () => {
    render(
      <ExtendBookingDialog booking={booking} nextReservations={horizonValue} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Change end date" }));

    expect(load).not.toHaveBeenCalled();
  });
});
