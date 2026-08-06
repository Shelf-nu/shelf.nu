/**
 * Behaviour pinned here is what the customer report was actually about: the
 * numbers a booking shows must describe the rows the operator can see, and
 * must never leave "rows or units?" ambiguous.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingModelReservationsSection } from "./booking-model-reservations-section";

const projectors = {
  id: "req-1",
  assetModelId: "model-1",
  quantity: 3,
  fulfilledQuantity: 0,
  fulfilledAt: null,
  assetModel: { id: "model-1", name: "PT-DZ21K Projector" },
};

const lenses = {
  id: "req-2",
  assetModelId: "model-2",
  quantity: 2,
  fulfilledQuantity: 1,
  fulfilledAt: null,
  assetModel: { id: "model-2", name: "ET-D75LE50 Lens" },
};

describe("BookingModelReservationsSection", () => {
  it("states units and models together so neither number is ambiguous", () => {
    render(
      <BookingModelReservationsSection modelRequests={[projectors, lenses]} />
    );

    // 3 outstanding + 1 outstanding = 4 units, across 2 reservation rows.
    // Showing only one of those numbers is what made the original UI unreadable.
    expect(screen.getByText("4 units across 2 models")).toBeInTheDocument();
  });

  it("describes each row's outstanding work in words, not a bare quantity", () => {
    render(
      <BookingModelReservationsSection modelRequests={[projectors, lenses]} />
    );

    expect(screen.getByText("3 units to assign")).toBeInTheDocument();
    expect(
      screen.getByText("1 of 2 units still to assign")
    ).toBeInTheDocument();
  });

  it("uses singular wording for a single unit and a single model", () => {
    render(
      <BookingModelReservationsSection
        modelRequests={[{ ...projectors, quantity: 1 }]}
      />
    );

    expect(screen.getByText("1 unit across 1 model")).toBeInTheDocument();
    expect(screen.getByText("1 unit to assign")).toBeInTheDocument();
  });

  it("renders nothing when every reservation is fulfilled", () => {
    const { container } = render(
      <BookingModelReservationsSection
        modelRequests={[
          { ...projectors, fulfilledQuantity: 3, fulfilledAt: new Date() },
        ]}
      />
    );

    // Fulfilled rows are history; they belong in the Models audit tab, not in
    // an "unassigned" section.
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the booking has no reservations", () => {
    const { container } = render(
      <BookingModelReservationsSection modelRequests={[]} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("tolerates a loader payload that omits the relation", () => {
    const { container } = render(
      <BookingModelReservationsSection modelRequests={undefined} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a per-row action when the surface supplies one", () => {
    render(
      <BookingModelReservationsSection
        modelRequests={[projectors, lenses]}
        renderAction={(request) => (
          <button>Assign {request.assetModel.name}</button>
        )}
      />
    );

    expect(
      screen.getByRole("button", { name: "Assign PT-DZ21K Projector" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Assign ET-D75LE50 Lens" })
    ).toBeInTheDocument();
  });

  it("omits the action cell entirely when the surface supplies none", () => {
    render(<BookingModelReservationsSection modelRequests={[projectors]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
