/**
 * "From location" picker tests: the "As planned" option names the plan, the
 * hint under it names the plan and is linked to the picker's trigger, and
 * nothing is posted until the operator changes the answer.
 *
 * @see {@link file://./checkout-source-select.tsx}
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ALLOCATION_SOURCE_FORM_VALUE } from "~/modules/booking/checkout-source-location";
import { asPlannedHint, CheckoutSourceSelect } from "./checkout-source-select";

afterEach(() => {
  cleanup();
});

/** A pool at Studio and Camera Room with unplaced units, planned as a split. */
const plannedQuestion = {
  title: "Cables",
  quantity: 15,
  unitOfMeasure: null,
  placements: [
    {
      locationId: "loc-camera",
      name: "Camera Room",
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
  unplaced: 20,
  defaultLocationId: ALLOCATION_SOURCE_FORM_VALUE,
  plannedSummary: "Studio 8 · Unplaced 7",
};

/** The hint the planned question shows under its picker. */
const PLANNED_HINT =
  "Planned: Studio 8 · Unplaced 7. These units go out by that plan; pick a location to take them from it instead.";

/** The picker's trigger, named by the titled label ("Cables · 15 units"). */
function getTrigger() {
  return screen.getByRole("button", { name: /Cables/ });
}

/** The hidden input that posts the answer, or `null` while none is posted. */
function getPostedInput(container: HTMLElement) {
  return container.querySelector<HTMLInputElement>(
    'input[type="hidden"][name="sourceLocation.ba-1"]'
  );
}

describe("CheckoutSourceSelect", () => {
  it('pre-selects "As planned" and names the split plan', () => {
    render(<CheckoutSourceSelect question={plannedQuestion} fieldKey="ba-1" />);

    const trigger = getTrigger();
    expect(trigger).toHaveTextContent("As planned: Studio 8 · Unplaced 7");

    fireEvent.click(trigger);
    expect(
      screen.getByRole("option", {
        name: "As planned: Studio 8 · Unplaced 7",
      })
    ).toHaveAttribute("aria-selected", "true");
  });

  it("describes the picker with the plan it sends the units out by", () => {
    render(<CheckoutSourceSelect question={plannedQuestion} fieldKey="ba-1" />);

    expect(getTrigger()).toHaveAccessibleDescription(PLANNED_HINT);
  });

  it("posts nothing until the operator picks, then posts the pick", () => {
    const { container } = render(
      <CheckoutSourceSelect question={plannedQuestion} fieldKey="ba-1" />
    );

    expect(getPostedInput(container)).toBeNull();

    fireEvent.click(getTrigger());
    fireEvent.click(screen.getByRole("option", { name: /^Camera Room/ }));

    expect(getPostedInput(container)).toHaveValue("loc-camera");
    expect(getTrigger()).toHaveTextContent(/^Camera Room/);
  });

  it("posts nothing when the operator re-picks the pre-selected option", () => {
    const { container } = render(
      <CheckoutSourceSelect question={plannedQuestion} fieldKey="ba-1" />
    );

    fireEvent.click(getTrigger());
    fireEvent.click(
      screen.getByRole("option", { name: "As planned: Studio 8 · Unplaced 7" })
    );

    expect(getPostedInput(container)).toBeNull();
  });

  it("shows no hint for a question that defaults to a location", () => {
    render(
      <CheckoutSourceSelect
        question={{ ...plannedQuestion, defaultLocationId: "loc-camera" }}
        fieldKey="ba-1"
      />
    );

    expect(getTrigger()).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText(/^Planned:/)).not.toBeInTheDocument();
  });
});

describe("asPlannedHint", () => {
  it("says Shelf picks the sources while nothing is planned yet", () => {
    expect(
      asPlannedHint({ defaultLocationId: ALLOCATION_SOURCE_FORM_VALUE })
    ).toBe(
      "Shelf picks the locations with room for these units. Pick a location to take them from it instead."
    );
  });

  it("is empty for a location default", () => {
    expect(
      asPlannedHint({
        defaultLocationId: "loc-camera",
        plannedSummary: "Studio 8 · Unplaced 7",
      })
    ).toBeNull();
  });
});
