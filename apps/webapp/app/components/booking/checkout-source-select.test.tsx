/**
 * "From location" select tests: the "As planned" option names the plan, the
 * hint under it says what leaving it alone does and is linked to the select,
 * and nothing is posted until the operator changes the answer.
 *
 * @see {@link file://./checkout-source-select.tsx}
 */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("CheckoutSourceSelect", () => {
  it('pre-selects "As planned" and names the split plan', () => {
    render(<CheckoutSourceSelect question={plannedQuestion} fieldKey="ba-1" />);

    const select = screen.getByRole("combobox");
    expect(select).toHaveValue(ALLOCATION_SOURCE_FORM_VALUE);
    expect(
      screen.getByRole("option", {
        name: "As planned: Studio 8 · Unplaced 7",
      })
    ).toBeInTheDocument();
  });

  it("describes the select with what the plan sends out", () => {
    render(<CheckoutSourceSelect question={plannedQuestion} fieldKey="ba-1" />);

    expect(screen.getByRole("combobox")).toHaveAccessibleDescription(
      "Leaves from Studio 8 · Unplaced 7. Pick a location to take these units from it instead."
    );
  });

  it("posts nothing until the operator picks, then posts the pick", async () => {
    const user = userEvent.setup();
    render(<CheckoutSourceSelect question={plannedQuestion} fieldKey="ba-1" />);

    const select = screen.getByRole("combobox");
    expect(select).not.toHaveAttribute("name");

    await user.selectOptions(select, "loc-camera");

    expect(select).toHaveAttribute("name", "sourceLocation.ba-1");
    expect(select).toHaveValue("loc-camera");
  });

  it("shows no hint for a question that defaults to a location", () => {
    render(
      <CheckoutSourceSelect
        question={{ ...plannedQuestion, defaultLocationId: "loc-camera" }}
        fieldKey="ba-1"
      />
    );

    expect(screen.getByRole("combobox")).not.toHaveAttribute(
      "aria-describedby"
    );
    expect(screen.queryByText(/Leaves from/)).not.toBeInTheDocument();
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
