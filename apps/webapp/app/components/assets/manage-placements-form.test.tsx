/**
 * ManagePlacementsForm — unit tests
 *
 * Focused on the over-placed state: what the dialog shows, and what it says,
 * when it opens onto a placement sum that already exceeds `Asset.quantity`.
 * That state is reachable without the user doing anything wrong (consumption
 * lowers the total without touching placements once the unplaced residual is
 * gone), so the form must name the real numbers rather than clamp them and
 * must not read as if the operator typed something invalid.
 *
 * @see {@link file://./manage-placements-form.tsx}
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ManagePlacementsForm } from "./manage-placements-form";

// why: the form renders the repo's `Form` (a react-router `<Form>` wrapper)
// and `Button` (which resolves `to` through react-router). Neither behaviour
// is under test here, and mounting a router just to assert on static text
// would obscure what these cases are about.
vi.mock("~/components/custom-form", () => ({
  Form: ({ children }: { children: ReactNode }) => <form>{children}</form>,
}));

vi.mock("~/components/shared/button", () => ({
  Button: ({
    children,
    disabled,
    ...rest
  }: {
    children: ReactNode;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} {...rest}>
      {children}
    </button>
  ),
}));

// why: `useDisabled` reads react-router's navigation state; there is no
// in-flight submission in these tests.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

const locations = [
  { id: "loc-1", name: "Baghdad Store" },
  { id: "loc-2", name: "Erbil Store" },
];

describe("ManagePlacementsForm — over-placed state", () => {
  it("shows the unplaced residual normally when placements fit", () => {
    render(
      <ManagePlacementsForm
        isQty
        assetQuantity={100}
        unitOfMeasure="pcs"
        locations={locations}
        serverErrorMessage={null}
        initialPlacements={[
          { locationId: "loc-1", locationName: "Baghdad Store", quantity: 60 },
        ]}
      />
    );

    expect(screen.getByText("Unplaced")).toBeInTheDocument();
    expect(screen.getByText("40 pcs")).toBeInTheDocument();
    expect(screen.queryByText("Over-placed")).not.toBeInTheDocument();
  });

  it("reports the overshoot as Over-placed instead of a clamped zero", () => {
    // 87 placed against a total that consumption dropped to 82.
    render(
      <ManagePlacementsForm
        isQty
        assetQuantity={82}
        unitOfMeasure="pcs"
        locations={locations}
        serverErrorMessage={null}
        initialPlacements={[
          { locationId: "loc-1", locationName: "Baghdad Store", quantity: 87 },
        ]}
      />
    );

    expect(screen.getByText("Over-placed")).toBeInTheDocument();
    expect(screen.getByText("5 pcs")).toBeInTheDocument();
    expect(screen.queryByText("Unplaced")).not.toBeInTheDocument();
  });

  it("leaves a kitted asset saveable and its manual pool intact", () => {
    // 80 manual + 50 kit-driven of a 100 total, which the database accepts:
    // `enforce_asset_location_sum_within_total` sums `assetKitId IS NULL`
    // rows only, and the kit axis is capped separately. Counting both axes
    // here used to block the dialog outright for this asset — no over-placed
    // row, but a validation error and a disabled Save, with no way out except
    // deleting valid manual placements to "make room" for the kit slice.
    // The kit slice also must not eat the manual pool: 20 units are still
    // free to place.
    render(
      <ManagePlacementsForm
        isQty
        assetQuantity={100}
        unitOfMeasure="pcs"
        locations={locations}
        serverErrorMessage={null}
        initialPlacements={[
          { locationId: "loc-1", locationName: "Baghdad Store", quantity: 80 },
        ]}
        kitDrivenPlacements={[
          {
            locationId: "loc-2",
            locationName: "Erbil Store",
            quantity: 50,
            kit: { id: "kit-1", name: "Field Kit" },
          },
        ]}
      />
    );

    expect(screen.queryByText("Over-placed")).not.toBeInTheDocument();
    expect(screen.getByText("Unplaced")).toBeInTheDocument();
    // Manual axis: 100 total − 80 manual. The kit slice is reported on its
    // own line and takes nothing away from this.
    expect(screen.getByText("20 pcs")).toBeInTheDocument();
    expect(
      screen.queryByText(/exceeds the asset's total quantity/)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Stock was used up while every unit was assigned/)
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save/i })).not.toBeDisabled();
  });

  it("explains an app-created over-allocation rather than blaming the user's input", () => {
    render(
      <ManagePlacementsForm
        isQty
        assetQuantity={82}
        unitOfMeasure="pcs"
        locations={locations}
        serverErrorMessage={null}
        initialPlacements={[
          { locationId: "loc-1", locationName: "Baghdad Store", quantity: 87 },
        ]}
      />
    );

    expect(
      screen.getByText(/Stock was used up while every unit was assigned/)
    ).toBeInTheDocument();
    // The old copy reported the user's untouched numbers back at them as an
    // error, which is what made this state feel like their mistake.
    expect(
      screen.queryByText(/exceeds the asset's total quantity/)
    ).not.toBeInTheDocument();
  });

  it("still uses the input-error wording when the user's own edit overshoots", () => {
    // Opened valid (50 of 100), so anything over the line from here is the
    // user's own edit and should read as ordinary validation.
    render(
      <ManagePlacementsForm
        isQty
        assetQuantity={100}
        unitOfMeasure="pcs"
        locations={locations}
        serverErrorMessage={null}
        initialPlacements={[
          { locationId: "loc-1", locationName: "Baghdad Store", quantity: 50 },
          { locationId: "loc-2", locationName: "Erbil Store", quantity: 40 },
        ]}
      />
    );

    // Per-row input caps at the asset total, so the overshoot has to come
    // from the SUM of two rows — 50 + 60 against a total of 100.
    fireEvent.change(screen.getByLabelText("Quantity for placement 2"), {
      target: { value: "60" },
    });

    expect(
      screen.getByText(/exceeds the asset's total quantity/)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Stock was used up while every unit was assigned/)
    ).not.toBeInTheDocument();
  });
});
