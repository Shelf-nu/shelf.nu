/**
 * Tests for {@link CheckoutDialog}'s "From location" question: the one-click
 * check-out stays one click for a booking with no pool at two or more
 * locations, and turns into a confirm dialog with one select per such pool
 * otherwise.
 *
 * @see {@link file://./checkout-dialog.tsx}
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { CheckoutSourceQuestion } from "~/modules/booking/checkout-source-location";

import CheckoutDialog from "./checkout-dialog";

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
    { locationId: "loc-store", name: "Store Room", placed: 60, left: 60 },
    { locationId: "loc-studio", name: "Studio", placed: 40, left: 40 },
  ],
  unplaced: 0,
  defaultLocationId: "loc-store",
};

/** Renders the dialog inside a form the way the booking page does. */
function renderInForm(sourceQuestions?: CheckoutSourceQuestion[]) {
  return render(
    <form id="edit-booking-form">
      <CheckoutDialog
        booking={booking}
        formId="edit-booking-form"
        sourceQuestions={sourceQuestions}
      />
    </form>
  );
}

describe("CheckoutDialog From location question", () => {
  it("stays a one-click submit when no pool asks", () => {
    const { container } = renderInForm([]);

    const button = screen.getByRole("button", { name: "Check Out" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveAttribute("value", "checkOut");
    expect(container.querySelector("select")).toBeNull();
  });

  it("asks where each pool's units leave from before checking out", () => {
    renderInForm([QUESTION]);

    const trigger = screen.getByRole("button", { name: "Check Out" });
    // The trigger no longer submits; it opens the question.
    expect(trigger).toHaveAttribute("type", "button");
    fireEvent.click(trigger);

    expect(
      screen.getByRole("heading", { name: "Where do the units come from?" })
    ).toBeInTheDocument();
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.name).toBe("sourceLocation.ba-1");
    expect(select.value).toBe("loc-store");
    expect(select.getAttribute("form")).toBe("edit-booking-form");
    expect([...select.options].map((option) => option.text)).toEqual([
      "Store Room · 60 pcs",
      "Studio · 40 pcs",
    ]);

    const submit = screen.getByRole("button", { name: "Check out" });
    expect(submit).toHaveAttribute("type", "submit");
    expect(submit).toHaveAttribute("value", "checkOut");
  });
});
