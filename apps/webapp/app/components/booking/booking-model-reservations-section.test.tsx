/**
 * Behaviour pinned here is what the customer report was actually about: the
 * numbers a booking shows must describe the rows the operator can see, and
 * must never leave "rows or units?" ambiguous.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("states remaining, reserved and model count so nothing is ambiguous", () => {
    render(
      <BookingModelReservationsSection modelRequests={[projectors, lenses]} />
    );

    // 3 + 1 = 4 still to assign, out of 3 + 2 = 5 reserved, across 2 rows.
    // Every number here is checkable against the rows below it by eye.
    expect(
      screen.getByText("4 of 5 units still to assign, across 2 models")
    ).toBeInTheDocument();
  });

  it("uses ONE shape for every row, including untouched ones", () => {
    render(
      <BookingModelReservationsSection modelRequests={[projectors, lenses]} />
    );

    // The regression this guards: an untouched row used to drop its
    // denominator ("3 units to assign") while a partially fulfilled one kept
    // it ("1 of 2 units still to assign"). Two shapes for the same thing meant
    // a reader could not tell whether a lone 3 was promised or remaining, and
    // the header total could not be checked without inferring the rule.
    expect(
      screen.getByText("3 of 3 units still to assign")
    ).toBeInTheDocument();
    expect(
      screen.getByText("1 of 2 units still to assign")
    ).toBeInTheDocument();
  });

  it("keeps the shape when a single unit is reserved", () => {
    render(
      <BookingModelReservationsSection
        modelRequests={[{ ...projectors, quantity: 1 }]}
      />
    );

    expect(
      screen.getByText("1 of 1 unit still to assign, across 1 model")
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 1 unit still to assign")).toBeInTheDocument();
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

  describe("pagination", () => {
    /** `count` distinct outstanding reservations, one unit each. */
    const manyModels = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `req-${i}`,
        assetModelId: `model-${i}`,
        quantity: 1,
        fulfilledQuantity: 0,
        fulfilledAt: null,
        assetModel: { id: `model-${i}`, name: `Model ${i}` },
      }));

    it("leaves a short list alone — no pager, every row visible", () => {
      render(
        <BookingModelReservationsSection modelRequests={manyModels(10)} />
      );

      expect(screen.getByText("Model 9")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Go to next page" })
      ).not.toBeInTheDocument();
    });

    it("shows one page at a time once the list outgrows the page size", () => {
      // The reported booking carried 40 models. Rendering all of them pushed
      // the assets list — and everything below it — off the page.
      render(
        <BookingModelReservationsSection modelRequests={manyModels(40)} />
      );

      expect(screen.getByText("Model 0")).toBeInTheDocument();
      expect(screen.getByText("Model 9")).toBeInTheDocument();
      expect(screen.queryByText("Model 10")).not.toBeInTheDocument();
      expect(screen.getByText("Showing 1-10 of 40 models")).toBeInTheDocument();
    });

    it("pages forward and back through the full list", async () => {
      const user = userEvent.setup();
      render(
        <BookingModelReservationsSection modelRequests={manyModels(40)} />
      );

      await user.click(screen.getByRole("button", { name: "Go to next page" }));

      expect(screen.getByText("Model 10")).toBeInTheDocument();
      expect(screen.queryByText("Model 0")).not.toBeInTheDocument();
      expect(
        screen.getByText("Showing 11-20 of 40 models")
      ).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Go to previous page" })
      );

      expect(screen.getByText("Model 0")).toBeInTheDocument();
    });

    it("stops at both ends of the list", async () => {
      const user = userEvent.setup();
      render(
        <BookingModelReservationsSection modelRequests={manyModels(25)} />
      );

      const next = screen.getByRole("button", { name: "Go to next page" });
      expect(
        screen.getByRole("button", { name: "Go to previous page" })
      ).toBeDisabled();

      await user.click(next);
      await user.click(next);

      // 25 models over pages of 10 — the last page holds the remaining 5.
      expect(
        screen.getByText("Showing 21-25 of 25 models")
      ).toBeInTheDocument();
      expect(next).toBeDisabled();
    });

    it("keeps the header totals describing the WHOLE list, not the page", () => {
      // The header is the booking's outstanding work. Paging is a view
      // concern; a total that changed with the page would be unusable.
      render(
        <BookingModelReservationsSection modelRequests={manyModels(40)} />
      );

      expect(
        screen.getByText("40 of 40 units still to assign, across 40 models")
      ).toBeInTheDocument();
    });
  });
});
