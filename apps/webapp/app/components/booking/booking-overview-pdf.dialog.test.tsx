/**
 * The Generate PDF dialog against each answer its route gives: a workspace
 * with PDF documents, one without, and a refusal.
 *
 * The route's side of the same contract is pinned by
 * `test/routes-tests/api+/bookings.$bookingId.generate-pdf.test.ts`.
 *
 * @see {@link file://./booking-overview-pdf.tsx}
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub, data } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { busyBookingPdfMeta } from "@factories";

import {
  BOOKING_CHECKLIST_CONFIG,
  CHECKOUT_RECEIPT_CONFIG,
} from "~/modules/pdf-document/config";
import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";

import { BookingOverviewPDF } from "./booking-overview-pdf";

// why: the page header renders `DateS`, which reads the acting user's format
// prefs from the root route loader that this stub does not have.
vi.mock("~/hooks/use-date-formatter", async () => {
  const actual = (await vi.importActual("~/utils/date-format")) as {
    formatDate: (
      value: string | Date,
      prefs: ResolvedFormatPrefs,
      opts?: DateFormatOptions
    ) => string;
  };
  const prefs: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H12",
    weekStartsOn: 1,
    timeZone: "UTC",
  };
  return {
    useDateFormatter: () => ({
      prefs,
      formatDate: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, opts),
      formatTime: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, { ...opts, onlyTime: true }),
      formatDateTime: (value: string | Date, opts?: DateFormatOptions) =>
        actual.formatDate(value, prefs, { ...opts, includeTime: true }),
    }),
  };
});

const CHECKLIST = {
  id: "doc-checklist",
  name: "Checklist",
  config: BOOKING_CHECKLIST_CONFIG,
};

/**
 * Renders the dialog's menu item on a booking page, with the generate route
 * answering `answer` and recording every URL it is asked for.
 */
function renderDialog(answer: () => unknown) {
  const requested: string[] = [];
  const Stub = createRoutesStub([
    {
      path: "/bookings/booking-1",
      Component: () => (
        <BookingOverviewPDF
          booking={{
            id: "booking-1",
            name: "Campaign Shoot",
            assets: [{ id: "asset-1" }],
          }}
        />
      ),
    },
    {
      path: "/api/bookings/:bookingId/generate-pdf",
      loader: ({ request }) => {
        requested.push(request.url);
        return answer();
      },
    },
  ]);
  render(<Stub initialEntries={["/bookings/booking-1"]} />);
  fireEvent.click(screen.getAllByRole("button", { name: "Generate PDF" })[0]);
  return requested;
}

describe("Generate PDF dialog", () => {
  it("offers the workspace's documents and titles the page by the one shown", async () => {
    renderDialog(() => ({
      error: null,
      pdfMeta: busyBookingPdfMeta(),
      document: CHECKLIST,
      documents: [
        { id: "doc-checklist", name: "Checklist", isDefault: true },
        { id: "doc-receipt", name: "Check-out receipt", isDefault: false },
      ],
    }));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Checklist - Campaign Shoot",
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Generate PDF for Campaign Shoot")).toBeVisible();
    expect(screen.getByText("Document")).toBeVisible();
    expect(screen.getByRole("combobox")).toHaveTextContent(
      "Checklist (default)"
    );
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeVisible();
  });

  it("offers no choice to a workspace without PDF documents and prints the page it always has", async () => {
    renderDialog(() => ({
      error: null,
      pdfMeta: busyBookingPdfMeta(),
      document: null,
      documents: [],
    }));

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Booking checklist for Campaign Shoot",
      })
    ).toBeInTheDocument();
    expect(screen.queryByText("Document")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeVisible();
  });

  it("shows a refusal in the dialog and loads the documents again on request", async () => {
    let refuse = true;
    const requested = renderDialog(() =>
      refuse
        ? data(
            {
              error: {
                message: "This document does not exist in your workspace.",
              },
            },
            { status: 404 }
          )
        : {
            error: null,
            pdfMeta: busyBookingPdfMeta(),
            document: { ...CHECKLIST, config: CHECKOUT_RECEIPT_CONFIG },
            documents: [
              { id: "doc-checklist", name: "Checklist", isDefault: true },
            ],
          }
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This document does not exist in your workspace."
    );
    expect(
      screen.queryByRole("button", { name: "Download PDF" })
    ).not.toBeInTheDocument();

    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload documents" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download PDF" })).toBeVisible()
    );
    expect(new URL(requested.at(-1)!).searchParams.has("document")).toBe(false);
  });
});
