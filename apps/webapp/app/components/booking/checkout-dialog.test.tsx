/**
 * Tests for {@link CheckoutDialog}: every quick check-out asks once before it
 * starts the booking, embedded callers that already confirm keep a direct
 * submit, and a pool at two or more locations adds a "From location" select.
 *
 * @see {@link file://./checkout-dialog.tsx}
 */
import { act, render, screen, fireEvent } from "@testing-library/react";
import { useNavigation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CheckoutSourceQuestion } from "~/modules/booking/checkout-source-location";

import CheckoutDialog from "./checkout-dialog";

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

/** A booking that started an hour ago, so no early-check-out prompt applies. */
const booking = {
  id: "booking-1",
  name: "Studio shoot",
  from: new Date(Date.now() - 60 * 60 * 1000),
};

const QUESTION: CheckoutSourceQuestion = {
  sliceId: "ba-1",
  assetId: "pool-1",
  title: "AA Batteries",
  unitOfMeasure: "pcs",
  quantity: 10,
  placements: [
    {
      locationId: "loc-store",
      name: "Store Room",
      placed: 60,
      inCustody: 0,
      onBooking: 0,
      left: 60,
    },
    {
      locationId: "loc-studio",
      name: "Studio",
      placed: 40,
      inCustody: 0,
      onBooking: 0,
      left: 40,
    },
  ],
  unplaced: 0,
  defaultLocationId: "loc-store",
};

/** A booking that starts in two days, so the early-check-out prompt applies. */
const earlyBooking = {
  id: "booking-2",
  name: "Field trip",
  from: new Date(Date.now() + 48 * 60 * 60 * 1000),
};

/**
 * Renders the dialog inside a form the way the booking page does and records
 * every submit with the fields it would send.
 */
function renderInForm(
  props: Partial<Parameters<typeof CheckoutDialog>[0]> = {}
) {
  const submissions: Array<[string, FormDataEntryValue][]> = [];
  const utils = render(
    <form
      id="edit-booking-form"
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
      <CheckoutDialog booking={booking} formId="edit-booking-form" {...props} />
    </form>
  );
  return { ...utils, submissions };
}

describe("CheckoutDialog confirmation", () => {
  it("opens a confirmation instead of submitting for a booking that is not early", () => {
    const { submissions } = renderInForm();

    const trigger = screen.getByRole("button", { name: "Check Out" });
    expect(trigger).toHaveAttribute("type", "button");
    fireEvent.click(trigger);

    expect(submissions).toHaveLength(0);
    expect(
      screen.getByRole("alertdialog", { name: "Check out booking" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This checks out every asset of/)
    ).toBeInTheDocument();
    expect(screen.getByText("Studio shoot")).toBeInTheDocument();
    expect(screen.getByText(/and starts the booking\./)).toBeInTheDocument();
  });

  it("submits intent=checkOut to the form once confirmed", () => {
    const { submissions } = renderInForm();

    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
    const submit = screen.getByRole("button", { name: "Check out" });
    expect(submit).toHaveAttribute("form", "edit-booking-form");
    fireEvent.click(submit);

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toContainEqual(["intent", "checkOut"]);
    expect(submissions[0].map(([name]) => name)).not.toContain(
      "checkoutIntentChoice"
    );
  });

  it("submits nothing when cancelled", () => {
    const { submissions } = renderInForm();

    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(submissions).toHaveLength(0);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("names the remaining assets for Check out remaining", () => {
    const { submissions } = renderInForm({
      intent: "checkOutRemaining",
      label: "Check out remaining",
      suppressEarlyCheckoutPrompt: true,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Check out remaining" })
    );

    expect(
      screen.getByText(/This checks out the remaining assets of/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/starts the booking/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    expect(submissions[0]).toContainEqual(["intent", "checkOutRemaining"]);
  });

  it("keeps the early warning and the date choice for an early check-out", () => {
    const { submissions } = renderInForm({ booking: earlyBooking });

    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));

    expect(
      screen.getByRole("alertdialog", { name: "Early Check-Out Warning" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/more than 15 minutes before the start date/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/This checks out/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Adjust Date" }));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toContainEqual(["intent", "checkOut"]);
    expect(submissions[0]).toContainEqual([
      "checkoutIntentChoice",
      "with-adjusted-date",
    ]);
  });

  it("submits directly when an embedding caller turns the confirmation off", () => {
    const { submissions } = renderInForm({ confirm: false });

    const button = screen.getByRole("button", { name: "Check Out" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("value", "checkOut");
    fireEvent.click(button);

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toContainEqual(["intent", "checkOut"]);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("still opens the early warning when the confirmation is off", () => {
    const { submissions } = renderInForm({
      booking: earlyBooking,
      confirm: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));

    expect(submissions).toHaveLength(0);
    expect(
      screen.getByRole("alertdialog", { name: "Early Check-Out Warning" })
    ).toBeInTheDocument();
  });

  it("closes once confirmed, but only after the form has submitted", () => {
    vi.useFakeTimers();
    try {
      const { submissions } = renderInForm();

      fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
      fireEvent.click(screen.getByRole("button", { name: "Check out" }));

      // The submitter lives in the dialog: it must still be mounted when the
      // browser runs the submission that follows the click.
      expect(submissions).toHaveLength(1);
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();

      act(() => {
        vi.runAllTimers();
      });
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits nothing and points at the blocking field when the form is invalid", () => {
    vi.useFakeTimers();
    /** Whether the dialog was still mounted when the form reported. */
    const dialogMountedAtReport: boolean[] = [];
    const reportValidity = vi
      .spyOn(HTMLFormElement.prototype, "reportValidity")
      .mockImplementation(() => {
        dialogMountedAtReport.push(
          document.querySelector('[role="alertdialog"]') !== null
        );
        return false;
      });
    try {
      const submissions: unknown[] = [];
      render(
        <form
          id="edit-booking-form"
          onSubmit={(event) => {
            event.preventDefault();
            submissions.push(event);
          }}
        >
          <input name="name" required defaultValue="" aria-label="Name" />
          <CheckoutDialog booking={booking} formId="edit-booking-form" />
        </form>
      );

      fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
      fireEvent.click(screen.getByRole("button", { name: "Check out" }));
      // First the deferred close commits, then Radix's focus scope runs its
      // own close timer, which is where the form reports.
      act(() => {
        vi.runAllTimers();
      });
      act(() => {
        vi.runAllTimers();
      });

      expect(submissions).toHaveLength(0);
      // The modal would hide the browser's message, so it steps aside and
      // the form reports the field that blocked the check-out.
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      // Reported once the dialog is gone, and focus is not pulled back to the
      // trigger over the field the browser just pointed at.
      expect(dialogMountedAtReport).toEqual([false]);
      expect(document.activeElement).not.toBe(
        screen.getByRole("button", { name: "Check Out" })
      );
    } finally {
      reportValidity.mockRestore();
      vi.useRealTimers();
    }
  });

  it("names neither every asset nor the booking start for any other intent", () => {
    renderInForm({ intent: "partial-checkout" });

    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));

    expect(
      screen.getByText(/This checks out the selected assets of/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/every asset/)).not.toBeInTheDocument();
    expect(screen.queryByText(/starts the booking/)).not.toBeInTheDocument();
  });
});

describe("CheckoutDialog while a submission is in flight", () => {
  afterEach(() => {
    vi.mocked(useNavigation).mockReturnValue({ state: "idle" } as never);
  });

  it("disables the trigger", () => {
    vi.mocked(useNavigation).mockReturnValue({ state: "submitting" } as never);
    renderInForm();

    expect(screen.getByRole("button", { name: "Check Out" })).toBeDisabled();
  });

  it("disables the direct submit when the confirmation is off", () => {
    vi.mocked(useNavigation).mockReturnValue({ state: "submitting" } as never);
    renderInForm({ confirm: false });

    expect(screen.getByRole("button", { name: "Check Out" })).toBeDisabled();
  });
});

describe("CheckoutDialog From location question", () => {
  it("adds no select when no pool asks", () => {
    const { container } = renderInForm({ sourceQuestions: [] });

    fireEvent.click(screen.getByRole("button", { name: "Check Out" }));
    expect(container.ownerDocument.querySelector("select")).toBeNull();
  });

  it("asks where each pool's units leave from before checking out", () => {
    renderInForm({ sourceQuestions: [QUESTION] });

    const trigger = screen.getByRole("button", { name: "Check Out" });
    // The trigger no longer submits; it opens the question.
    expect(trigger).toHaveAttribute("type", "button");
    fireEvent.click(trigger);

    expect(
      screen.getByRole("heading", { name: "Where do the units come from?" })
    ).toBeInTheDocument();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.name).toBe("");
    expect(select.value).toBe("loc-store");
    expect(select.getAttribute("form")).toBe("edit-booking-form");
    expect([...select.options].map((option) => option.text)).toEqual([
      "Store Room · 60 pcs",
      "Studio · 40 pcs",
    ]);
    // Unchanged, it posts nothing and the server records its own default;
    // once the operator picks, the answer is posted under the slice's key.
    fireEvent.change(select, { target: { value: "loc-studio" } });
    expect(select.name).toBe("sourceLocation.ba-1");

    const submit = screen.getByRole("button", { name: "Check out" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).toHaveAttribute("value", "checkOut");
  });
});
