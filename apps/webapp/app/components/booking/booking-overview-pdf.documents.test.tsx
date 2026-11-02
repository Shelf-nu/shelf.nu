/**
 * What each document prints: the Check-out receipt, a document with custom field
 * columns, and a document grouped by category.
 *
 * Rendered from the same busy booking as the Checklist parity test, so every
 * difference on the page comes from the document.
 *
 * @see {@link file://./booking-overview-pdf.tsx}
 * @see {@link file://./booking-overview-pdf.checklist.test.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { busyBookingPdfMeta } from "@factories";

import type { PdfDbResult } from "~/modules/booking/pdf-helpers";
import type { BookingDocumentConfig } from "~/modules/pdf-document/config";
import {
  BOOKING_CHECKLIST_CONFIG,
  CHECKOUT_RECEIPT_CONFIG,
} from "~/modules/pdf-document/config";
import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";

import { BookingPDFPreview } from "./booking-overview-pdf";

// why: the header renders `DateS`, which reads the acting user's format prefs
// through this hook. It reaches the root route loader, and a unit test has no
// router.
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

function renderDocument(
  name: string,
  config: BookingDocumentConfig,
  pdfMeta: PdfDbResult = busyBookingPdfMeta()
) {
  return render(
    <BookingPDFPreview
      componentRef={{ current: null }}
      pdfMeta={pdfMeta}
      pdfDocument={{ name, config }}
    />
  );
}

function headers(container: HTMLElement) {
  return [
    ...container.querySelectorAll("table.booking-assets-table thead th"),
  ].map((th) => th.textContent);
}

function widths(container: HTMLElement) {
  return [...container.querySelectorAll("table.booking-assets-table col")].map(
    (col) => parseFloat((col as HTMLElement).style.width)
  );
}

describe("booking PDF: the Check-out receipt document", () => {
  it("is titled by the document and drops descriptions and the total value", () => {
    const { container } = renderDocument(
      "Check-out receipt",
      CHECKOUT_RECEIPT_CONFIG
    );

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Check-out receipt - Campaign Shoot"
    );
    expect(screen.queryByText("Asset Description")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Cinema camera with Super 35 sensor.")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Description")).not.toBeInTheDocument();
    expect(screen.queryByText(/Load the van first/)).not.toBeInTheDocument();
    expect(screen.queryByText("Total assets value")).not.toBeInTheDocument();
    expect(screen.queryByText("$11,077.95")).not.toBeInTheDocument();
    expect(headers(container)).toEqual([
      "#",
      "Image",
      "Name",
      "Qty",
      "Kit",
      "Category",
      "Location",
      "Code",
    ]);
  });

  it("ends with signature lines, the custodian's name printed under theirs", () => {
    renderDocument("Check-out receipt", CHECKOUT_RECEIPT_CONFIG);

    const signatures = within(screen.getByLabelText("Signatures"));
    expect(signatures.getByText("Custodian signature · date")).toBeVisible();
    expect(signatures.getByText("Ada Lovelace")).toBeVisible();
    expect(signatures.getByText("Issued by · date")).toBeVisible();
  });

  it("has no signature lines on the Checklist", () => {
    renderDocument("Checklist", BOOKING_CHECKLIST_CONFIG);

    expect(screen.queryByLabelText("Signatures")).not.toBeInTheDocument();
  });
});

describe("booking PDF: custom field columns", () => {
  function quoteMeta() {
    const pdfMeta = busyBookingPdfMeta();
    pdfMeta.customFields = [
      { id: "cf-price", name: "Price per day", type: "AMOUNT" },
      { id: "cf-notes", name: "Handling notes", type: "MULTILINE_TEXT" },
    ];
    pdfMeta.assets[0].customFieldValues = {
      "cf-price": "€85.00",
      "cf-notes": "Keep the sensor cap on.\nCharge overnight.",
    };
    pdfMeta.assets[1].customFieldValues = { "cf-price": "€5.00" };
    return pdfMeta;
  }

  const quote: BookingDocumentConfig = {
    ...BOOKING_CHECKLIST_CONFIG,
    columns: { ...BOOKING_CHECKLIST_CONFIG.columns, image: false },
    customFieldIds: ["cf-price", "cf-notes"],
  };

  it("prints a column per field before Code, with the printed values and an empty cell for none", () => {
    const { container } = renderDocument("Client quote", quote, quoteMeta());

    expect(headers(container)).toEqual([
      "#",
      "Name",
      "Qty",
      "Kit",
      "Category",
      "Location",
      "Price per day",
      "Code",
    ]);
    const priceOf = (title: string) => {
      const cells = screen
        .getByText(title)
        .closest("tr")!
        .querySelectorAll("td");
      return cells[6].textContent;
    };
    expect(priceOf("Canon C200")).toBe("€85.00");
    expect(priceOf("Battery V-mount")).toBe("€5.00");
    expect(priceOf("Sandbag")).toBe("");
  });

  it("prints a multi-line field under the asset, not as a column", () => {
    renderDocument("Client quote", quote, quoteMeta());

    expect(screen.getByText("Handling notes")).toBeVisible();
    expect(screen.getByText(/Keep the sensor cap on\./)).toBeVisible();
  });

  it("drops the multi-line field with the description row", () => {
    renderDocument(
      "Client quote",
      { ...quote, assetDescription: false },
      quoteMeta()
    );

    expect(screen.queryByText("Handling notes")).not.toBeInTheDocument();
  });

  it("keeps Code at its own width and shares the rest among the other columns", () => {
    const { container } = renderDocument("Client quote", quote, quoteMeta());
    const shares = widths(container);

    expect(shares.at(-1)).toBe(27);
    expect(shares.reduce((sum, w) => sum + w, 0)).toBeCloseTo(100, 6);
    expect(shares).toHaveLength(headers(container).length);
  });
});

describe("booking PDF: grouped by category", () => {
  const grouped: BookingDocumentConfig = {
    ...BOOKING_CHECKLIST_CONFIG,
    groupBy: "category",
  };

  it("prints a header per category with its count, A to Z, uncategorized last", () => {
    const { container } = renderDocument("By category", grouped);

    const groupHeaders = [...container.querySelectorAll("tbody td[colspan]")]
      .map((td) => td.textContent)
      .filter((text) => text?.includes(" · "));
    expect(groupHeaders).toEqual([
      "Batteries · 1",
      "Camera · 1",
      "Lighting · 1",
      "Monitors · 1",
      "Uncategorized · 1",
    ]);
  });

  it("keeps numbering the rows straight through, each with its kit", () => {
    renderDocument("By category", grouped);

    const rowOf = (title: string) =>
      [...screen.getByText(title).closest("tr")!.querySelectorAll("td")].map(
        (td) => td.textContent
      );
    expect(rowOf("Battery V-mount").slice(0, 1)).toEqual(["1"]);
    expect(rowOf("Battery V-mount")[4]).toBe("Camera kit");
    expect(rowOf("Canon C200").slice(0, 1)).toEqual(["2"]);
    expect(rowOf("Canon C200")[4]).toBe("Camera kit");
    expect(rowOf("Sandbag").slice(0, 1)).toEqual(["5"]);
  });
});
