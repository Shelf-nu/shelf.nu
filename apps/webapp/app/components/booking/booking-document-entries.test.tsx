/**
 * The document tail both booking menus render: nothing when neither document
 * is offered, otherwise a divider and each offered entry, disabled exactly as
 * the rules decided.
 *
 * @see {@link file://./booking-document-entries.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BookingActionDisabled, BookingActions } from "./booking-actions";
import { BookingDocumentEntries } from "./booking-document-entries";

/** What a stand-in entry was handed. */
type StubProps = {
  disabled: BookingActionDisabled;
  assetOrder?: { orderBy: string; orderDirection: string };
};

/**
 * A stand-in entry that shows its inputs: the reason as its title, the sort
 * as a data attribute.
 */
function stubEntry(label: string) {
  return function StubEntry({ disabled, assetOrder }: StubProps) {
    return (
      <button
        type="button"
        disabled={disabled !== false}
        title={disabled ? disabled.reason : undefined}
        data-order-by={assetOrder?.orderBy}
      >
        {label}
      </button>
    );
  };
}

// why: each PDF entry owns a fetcher and a print dialog with their own tests;
// this one asserts which entries render and what they are handed.
vi.mock("./booking-overview-pdf", () => ({
  BookingOverviewPDF: stubEntry("Booking document"),
}));
// why: see the booking document stub.
vi.mock("./booking-checkin-receipt-pdf", () => ({
  BookingCheckinReceiptPDF: stubEntry("Check-in receipt"),
}));

const BOOKING = { id: "booking-1", name: "Shoot" };

const SHOWN = { visible: true, disabled: false } as const;
const HIDDEN = { visible: false } as const;

/**
 * Renders the entries after a sibling, the way a menu does: the divider only
 * draws between two elements.
 */
function renderEntries(
  actions: Pick<BookingActions, "bookingDocument" | "checkinReceipt">,
  assetOrder?: StubProps["assetOrder"]
) {
  return render(
    <div data-testid="menu">
      <button type="button">Duplicate</button>
      <BookingDocumentEntries
        booking={BOOKING}
        actions={actions}
        assetOrder={assetOrder}
      />
    </div>
  );
}

describe("BookingDocumentEntries", () => {
  it("renders nothing when neither document is offered", () => {
    renderEntries({ bookingDocument: HIDDEN, checkinReceipt: HIDDEN });

    expect(screen.getByTestId("menu").children).toHaveLength(1);
  });

  it("renders a divider, then each offered entry in order", () => {
    renderEntries({ bookingDocument: SHOWN, checkinReceipt: SHOWN });

    const children = [...screen.getByTestId("menu").children];
    expect(children.map((child) => child.textContent)).toEqual([
      "Duplicate",
      "",
      "Booking document",
      "Check-in receipt",
    ]);
  });

  it("renders only the offered entry", () => {
    renderEntries({ bookingDocument: HIDDEN, checkinReceipt: SHOWN });

    expect(screen.queryByText("Booking document")).not.toBeInTheDocument();
    expect(screen.getByText("Check-in receipt")).toBeInTheDocument();
  });

  it("passes each entry the disabled state the rules decided, and the sort", () => {
    renderEntries(
      {
        bookingDocument: SHOWN,
        checkinReceipt: {
          visible: true,
          disabled: { reason: "This booking was never checked out." },
        },
      },
      { orderBy: "name", orderDirection: "asc" }
    );

    const documentEntry = screen.getByRole("button", {
      name: "Booking document",
    });
    const receipt = screen.getByRole("button", { name: "Check-in receipt" });
    expect(documentEntry).toBeEnabled();
    expect(receipt).toBeDisabled();
    expect(receipt).toHaveAttribute(
      "title",
      "This booking was never checked out."
    );
    expect(documentEntry).toHaveAttribute("data-order-by", "name");
    expect(receipt).toHaveAttribute("data-order-by", "name");
  });
});
