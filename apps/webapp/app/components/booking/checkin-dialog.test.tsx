/**
 * Tests for {@link CheckinDialog}: every check-in asks once before it
 * submits, including a booking whose end has already passed, so one click on
 * "Quick check-in" can no longer complete a booking by accident.
 *
 * @see {@link file://./checkin-dialog.tsx}
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CheckinDialog from "./checkin-dialog";

// why: `useDisabled` reads `useNavigation`, which needs a data router this
// component test does not mount.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigation: vi.fn(() => ({ state: "idle" })),
  };
});

// why: `DateS` reads the user's format preferences from the root loader data,
// which this component test does not mount. The dates are not under test.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: Date | string }) => (
    <span>{new Date(date).toISOString()}</span>
  ),
}));

const HOUR = 60 * 60 * 1000;

/** A booking that ended an hour ago, so no early check-in warning applies. */
const pastEndBooking = {
  id: "booking-1",
  name: "Studio shoot",
  from: new Date(Date.now() - 3 * HOUR),
  to: new Date(Date.now() - HOUR),
};

/** A booking that started an hour ago and ends in two days. */
const earlyBooking = {
  id: "booking-2",
  name: "Field trip",
  from: new Date(Date.now() - HOUR),
  to: new Date(Date.now() + 48 * HOUR),
};

/**
 * Renders the dialog inside a form the way the booking page does and records
 * every submit with the fields it would send.
 */
function renderInForm(
  props: Partial<Parameters<typeof CheckinDialog>[0]> = {}
) {
  const submissions: Array<[string, FormDataEntryValue][]> = [];
  const utils = render(
    <form
      id="booking-form"
      onSubmit={(event) => {
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        const entries = [...new FormData(event.currentTarget).entries()];
        if (submitter instanceof HTMLButtonElement && submitter.name) {
          entries.push([submitter.name, submitter.value]);
        }
        submissions.push(entries);
      }}
    >
      <CheckinDialog
        booking={pastEndBooking}
        formId="booking-form"
        label="Quick check-in"
        variant="dropdown"
        {...props}
      />
    </form>
  );
  return { ...utils, submissions };
}

describe("CheckinDialog", () => {
  it("opens a confirmation instead of submitting for a past-end booking", () => {
    const { submissions } = renderInForm();

    const trigger = screen.getByRole("button", { name: /Quick check-in/ });
    expect(trigger).toHaveAttribute("type", "button");

    fireEvent.click(trigger);

    expect(submissions).toHaveLength(0);
    expect(
      screen.getByRole("alertdialog", { name: "Check in booking" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This checks in every asset of/)
    ).toBeInTheDocument();
    expect(screen.getByText("Studio shoot")).toBeInTheDocument();
    expect(
      screen.queryByText(/more than 15 minutes before the end date/)
    ).not.toBeInTheDocument();
  });

  it("submits intent=checkIn with no date choice once confirmed", () => {
    const { submissions } = renderInForm();

    fireEvent.click(screen.getByRole("button", { name: /Quick check-in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toContainEqual(["intent", "checkIn"]);
    expect(submissions[0].map(([name]) => name)).not.toContain(
      "checkinIntentChoice"
    );
  });

  it("submits nothing when cancelled", () => {
    const { submissions } = renderInForm();

    fireEvent.click(screen.getByRole("button", { name: /Quick check-in/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(submissions).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the early warning and the date choice for an early check-in", () => {
    const { submissions } = renderInForm({ booking: earlyBooking });

    fireEvent.click(screen.getByRole("button", { name: /Quick check-in/ }));

    expect(
      screen.getByText(/more than 15 minutes before the end date/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Adjust Date" }));

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toContainEqual(["intent", "checkIn"]);
    expect(submissions[0]).toContainEqual([
      "checkinIntentChoice",
      "with-adjusted-date",
    ]);
  });

  it("names the selected assets for a partial check-in", () => {
    renderInForm({
      intent: "partial-checkin",
      specificAssetIds: ["asset-1", "asset-2"],
    });

    fireEvent.click(screen.getByRole("button", { name: /Quick check-in/ }));

    expect(screen.getByText(/This checks in 2 assets of/)).toBeInTheDocument();
  });
});
