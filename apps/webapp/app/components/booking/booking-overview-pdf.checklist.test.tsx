/**
 * The Checklist prints the booking PDF as it was before PDF documents existed.
 *
 * `__snapshots__/checklist-document.html` is the markup the booking PDF rendered
 * for one busy booking before it read a document, recorded by the commit that
 * added this test. A free workspace must keep printing exactly that page; a
 * paid workspace's seeded "Checklist" document prints it too, titled by the
 * document ("Checklist - ...") where the page said "Booking checklist for ...".
 *
 * @see {@link file://./booking-overview-pdf.tsx}
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { busyBookingPdfMeta } from "@factories";

import { BOOKING_CHECKLIST_CONFIG } from "~/modules/pdf-document/config";
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

describe("booking PDF: the Checklist document", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function printedMarkup(
    pdfDocument: {
      name: string;
      config: typeof BOOKING_CHECKLIST_CONFIG;
    } | null
  ) {
    return render(
      <BookingPDFPreview
        componentRef={{ current: null }}
        pdfMeta={busyBookingPdfMeta()}
        pdfDocument={pdfDocument}
      />
    ).container.innerHTML;
  }

  const before = () =>
    readFileSync(
      join(__dirname, "__snapshots__", "checklist-document.html"),
      "utf8"
    );

  it("prints exactly the page it always has for a workspace without PDF documents", () => {
    expect(printedMarkup(null)).toBe(before());
  });

  it("prints the same page for a workspace's Checklist document, titled by the document", () => {
    expect(before()).toContain("Booking checklist for Campaign Shoot");
    expect(
      printedMarkup({ name: "Checklist", config: BOOKING_CHECKLIST_CONFIG })
    ).toBe(
      before().replace(
        "Booking checklist for Campaign Shoot",
        "Checklist - Campaign Shoot"
      )
    );
  });
});
