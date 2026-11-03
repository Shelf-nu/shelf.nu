/**
 * The check-in receipt entry's request: which sort it loads the sheet with.
 *
 * Kept apart from `booking-checkin-receipt-pdf.test.tsx`, which stubs the
 * fetcher; these tests need the real one to see the URL it asks for.
 *
 * @see {@link file://./booking-checkin-receipt-pdf.tsx}
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { BookingCheckinReceiptPDF } from "./booking-checkin-receipt-pdf";

describe("booking check-in receipt: which sort it loads with", () => {
  /** Renders the entry on a page whose URL carries a sort, and opens it. */
  function openOnPage(assetOrder?: {
    orderBy: string;
    orderDirection: string;
  }) {
    const requested: string[] = [];
    const Stub = createRoutesStub([
      {
        path: "/bookings/booking-1",
        Component: () => (
          <BookingCheckinReceiptPDF
            booking={{ id: "booking-1", name: "Shoot" }}
            disabled={false}
            assetOrder={assetOrder}
          />
        ),
      },
      {
        path: "/api/bookings/:bookingId/generate-checkin-receipt",
        loader: ({ request }) => {
          requested.push(request.url);
          return null;
        },
      },
    ]);
    render(
      <Stub
        initialEntries={["/bookings/booking-1?orderBy=from&orderDirection=asc"]}
      />
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: /Generate check-in receipt/ })[0]
    );
    return requested;
  }

  it("loads the receipt without the page's orderBy when no assetOrder is given", async () => {
    const requested = openOnPage();

    await waitFor(() => expect(requested).toHaveLength(1));
    expect(new URL(requested[0]).searchParams.has("orderBy")).toBe(false);
    expect(new URL(requested[0]).searchParams.has("orderDirection")).toBe(
      false
    );
  });

  it("loads with the given assetOrder", async () => {
    const requested = openOnPage({ orderBy: "name", orderDirection: "asc" });

    await waitFor(() => expect(requested).toHaveLength(1));
    const params = new URL(requested[0]).searchParams;
    expect(params.get("orderBy")).toBe("name");
    expect(params.get("orderDirection")).toBe("asc");
  });
});
