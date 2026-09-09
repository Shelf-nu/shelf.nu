/**
 * The printed body of the booking check-in receipt.
 *
 * The receipt is evidence: it gets handed to a client, stapled to an insurance
 * claim, and signed by someone being told a unit did not come back. These tests
 * are about what ends up ON PAPER — the completeness stamp, the per-row
 * disposition counts, the ledger with its zeros, and the two things the sheet
 * must never invent: a receiving user nobody recorded, and a "missing" verdict
 * on an item that never left.
 *
 * @see {@link file://./booking-checkin-receipt-pdf.tsx}
 * @see {@link file://../../modules/booking/checkin-receipt.ts}
 */
import { BookingStatus } from "@prisma/client";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type {
  CheckinReceiptView,
  CheckinReceiptViewRow,
} from "~/modules/booking/checkin-receipt";
import type {
  DateFormatOptions,
  ResolvedFormatPrefs,
} from "~/utils/date-format";

import {
  BookingCheckinReceiptPDF,
  BookingCheckinReceiptPreview,
} from "./booking-checkin-receipt-pdf";

// why: the header renders `DateS`, which reads the acting user's format prefs
// through this hook — it reaches the root route loader, and there is no router
// in a unit test. Same stub shape as `reports/report-table.test.tsx`.
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

// why: the menu entry calls `useFetcher` to load the sheet, which needs a data
// router. These tests only assert whether the entry is offered, so an idle
// fetcher that loads nothing is enough. Same shape as
// `calendar-feed-controls.test.tsx`.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle" as const,
      data: undefined,
      load: vi.fn(),
      submit: vi.fn(),
    }),
  };
});

// why: the entry reads the booking page's sort out of the URL. There is no
// router-provided query string here, and the sort plays no part in whether the
// entry is offered.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

/** A returned individual row, the ordinary case every override starts from. */
function row(
  overrides: Partial<CheckinReceiptViewRow> = {}
): CheckinReceiptViewRow {
  return {
    bookingAssetId: "ba-1",
    assetId: "asset-1",
    isQuantityTracked: false,
    state: "RETURNED",
    sent: 1,
    returned: 1,
    consumed: 0,
    lost: 0,
    damaged: 0,
    stillOut: 0,
    title: "Tripod",
    quantity: 1,
    kitName: null,
    isRemovedFromKit: false,
    displayCode: {
      value: "SAM-0001",
      type: "SAM_ID",
      isFallback: false,
      entityKind: "asset",
      workspacePreference: "SAM_ID",
    },
    checkedInByName: "Ada Lovelace",
    checkedInOn: "03/09/2026 5:30 PM",
    ...overrides,
  };
}

/** A one-row receipt, with any part of the sheet overridden. */
function viewWith(
  overrides: Partial<CheckinReceiptView> = {}
): CheckinReceiptView {
  const rows = overrides.rows ?? [row()];
  return {
    booking: {
      id: "booking-1",
      name: "Shoot",
      description: null,
      custodianUser: null,
      custodianTeamMember: { name: "Lucia Ortega" },
      tags: [],
    },
    organization: {
      name: "Org",
      imageId: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    totals: {
      itemsBooked: rows.length,
      unitsSentOut: 1,
      returned: 1,
      consumed: 0,
      lost: 0,
      damaged: 0,
      stillOut: 0,
    },
    stamp: "All items returned",
    plannedFrom: "01/09/2026 9:00 AM",
    plannedTo: "02/09/2026 6:00 PM",
    checkedOutAt: "01/09/2026 8:41 AM",
    checkedOutByName: "Marco Ruiz",
    returnedAt: "03/09/2026 5:30 PM",
    latenessNote: { text: "16 hours after the planned end", isLate: true },
    checkedInByNames: ["Ada Lovelace"],
    ...overrides,
    rows,
  };
}

/** Renders the printable receipt body. */
function renderReceipt(overrides: Partial<CheckinReceiptView> = {}) {
  return render(
    <BookingCheckinReceiptPreview
      componentRef={{ current: null }}
      pdfMeta={viewWith(overrides)}
    />
  );
}

/** The sheet's key-value block, where the booking-level facts print. */
function factsBlock(container: HTMLElement) {
  const section = container.querySelector("section");
  expect(section).toBeTruthy();
  return section as HTMLElement;
}

/** The cells of the row printed for `title`. */
function cellsFor(title: string) {
  const cells = screen.getByText(title).closest("tr")?.querySelectorAll("td");
  expect(cells).toBeTruthy();
  return cells!;
}

describe("booking check-in receipt — the sheet", () => {
  it("states completeness in the header stamp and nowhere else", () => {
    // why: the stamp is the one sentence a reader takes away from the sheet,
    // and there is no status row to carry it instead.
    renderReceipt({ stamp: "Partial return · 4 still out" });

    expect(
      screen.getByText("Partial return · 4 still out")
    ).toBeInTheDocument();
  });

  it("appends the lateness measurement to the recorded return", () => {
    const { container } = renderReceipt();

    const returnedFact = within(factsBlock(container))
      .getByText("Returned")
      .closest("div");

    expect(returnedFact).toHaveTextContent("03/09/2026 5:30 PM");
    expect(returnedFact).toHaveTextContent("16 hours after the planned end");
  });

  it("does not call the closing moment a return when nothing came back", () => {
    // why: a booking whose every unit was written off closed at a moment, but
    // nothing was returned. "Returned" on that row is the same false claim the
    // stamp used to make.
    const { container } = renderReceipt({
      rows: [
        row({
          isQuantityTracked: true,
          quantity: 6,
          sent: 6,
          returned: 0,
          lost: 6,
        }),
      ],
      totals: {
        itemsBooked: 1,
        unitsSentOut: 6,
        returned: 0,
        consumed: 0,
        lost: 6,
        damaged: 0,
        stillOut: 0,
      },
      stamp: "All items accounted for",
    });

    const facts = factsBlock(container);
    expect(within(facts).queryByText("Returned")).not.toBeInTheDocument();
    expect(within(facts).getByText("Accounted for")).toBeInTheDocument();
  });

  it("omits the returned line entirely when nothing recorded a return", () => {
    // why: a booking whose completion predates the activity log has no recorded
    // moment. A blank row would read as "returned at no time"; the sheet must
    // simply not claim it.
    const { container } = renderReceipt({
      returnedAt: null,
      latenessNote: null,
    });

    expect(
      within(factsBlock(container)).queryByText("Returned")
    ).not.toBeInTheDocument();
  });

  it("prints each disposition count for a quantity row", () => {
    renderReceipt({
      rows: [
        row({
          title: "XLR cable 5 m",
          isQuantityTracked: true,
          quantity: 10,
          sent: 10,
          returned: 9,
          damaged: 1,
        }),
      ],
    });

    const cells = cellsFor("XLR cable 5 m");
    const returnedCell = cells[5];
    expect(returnedCell).toHaveTextContent("9 returned");
    expect(returnedCell).toHaveTextContent("1 damaged");
  });

  it("names an item that never left as never checked out, not as missing", () => {
    // why: a slice added onto an ongoing booking has nothing to reconcile.
    // Reading it as unreturned would accuse a custodian of losing something
    // that never moved.
    renderReceipt({
      rows: [row({ state: "NEVER_CHECKED_OUT", sent: 0, returned: 0 })],
    });

    expect(cellsFor("Tripod")[5]).toHaveTextContent("Never checked out");
  });

  it("leaves the receiving user blank when the marker recorded none", () => {
    // why: backfilled rows carry a check-in time with no user. Filling the gap
    // with the custodian or the printing user would put a name on paper that
    // nobody recorded.
    renderReceipt({
      rows: [row({ checkedInByName: "" })],
      checkedInByNames: [],
    });

    expect(cellsFor("Tripod")[7]).toHaveTextContent("");
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();
  });

  it("prints every line of the ledger, zeros included", () => {
    // why: a zero is the evidence that nothing was lost. A hidden line reads as
    // a number nobody checked.
    renderReceipt();

    for (const label of [
      "Items booked",
      "Units sent out",
      "Returned",
      "Consumed",
      "Lost",
      "Damaged",
      "Still out",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("prints both signature lines for the hand-over", () => {
    renderReceipt();

    expect(
      screen.getByText("Returned by (custodian) · name, signature, date")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Received by · name, signature, date")
    ).toBeInTheDocument();
  });

  it("prints no asset values and no QR image", () => {
    // why: the sheet is handed to custodians and clients, and a scannable code
    // on the paper defeats scanning the label on the item.
    const { container } = renderReceipt();

    expect(screen.queryByAltText("QR Code")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Total assets value/);
  });

  it("prints the workspace's asset code on the row", () => {
    renderReceipt();

    expect(cellsFor("Tripod")[4]).toHaveTextContent("SAM-0001");
  });

  it("explains a row still filed under a kit it has left", () => {
    // why: paper has no tooltip, so a detached row is otherwise
    // indistinguishable from a live kit member.
    renderReceipt({
      rows: [row({ kitName: "Camera A", isRemovedFromKit: true })],
    });

    expect(
      within(cellsFor("Tripod")[3] as HTMLElement).getByText(/Removed from kit/)
    ).toBeInTheDocument();
  });
});

/** Renders the Actions-menu entry for a booking in the given shape. */
function renderEntry(
  booking: {
    status: BookingStatus;
    bookingAssets: Array<{
      checkedOutAt: string | null;
      checkedInAt: string | null;
    }>;
  },
  hasDispositionedUnits = false
) {
  return render(
    <MemoryRouter>
      <BookingCheckinReceiptPDF
        booking={{ id: "booking-1", name: "Shoot", ...booking }}
        hasDispositionedUnits={hasDispositionedUnits}
        timeStamp={1757000000000}
      />
    </MemoryRouter>
  );
}

/** The desktop copy of the menu entry. */
function entryButton() {
  return screen.getAllByRole("button", {
    name: /Generate check-in receipt/,
  })[0];
}

describe("booking check-in receipt — when the entry is offered", () => {
  it("offers the receipt once a checked-out booking has been checked in", () => {
    renderEntry({
      status: BookingStatus.COMPLETE,
      bookingAssets: [
        {
          checkedOutAt: "2026-09-01T09:00:00.000Z",
          checkedInAt: "2026-09-03T17:30:00.000Z",
        },
      ],
    });

    expect(entryButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("offers it on a partial return, before the booking is finished", () => {
    // why: a partial return is exactly the case a printed record is wanted
    // for, so the entry must not wait for the booking to close.
    renderEntry({
      status: BookingStatus.ONGOING,
      bookingAssets: [
        {
          checkedOutAt: "2026-09-01T09:00:00.000Z",
          checkedInAt: "2026-09-02T10:00:00.000Z",
        },
        { checkedOutAt: "2026-09-01T09:00:00.000Z", checkedInAt: null },
      ],
    });

    expect(entryButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("offers it once a quantity slice has returned part of what it sent", () => {
    // why: a partly-returned quantity slice keeps `checkedInAt` NULL, because
    // that marker means fully reconciled. Reading the markers alone would
    // withhold the receipt from the partial return it exists to record.
    renderEntry(
      {
        status: BookingStatus.ONGOING,
        bookingAssets: [
          { checkedOutAt: "2026-09-01T09:00:00.000Z", checkedInAt: null },
        ],
      },
      true
    );

    expect(entryButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("refuses a finished booking that never went out", () => {
    // why: archiving a reserved booking finishes it without a single check-out
    // marker. A receipt for it would be a return document over rows that never
    // moved.
    renderEntry({
      status: BookingStatus.ARCHIVED,
      bookingAssets: [{ checkedOutAt: null, checkedInAt: null }],
    });

    expect(entryButton()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getAllByText("This booking was never checked out.").length
    ).toBeGreaterThan(0);
  });

  it("says nothing has come back yet while everything is still out", () => {
    renderEntry({
      status: BookingStatus.ONGOING,
      bookingAssets: [
        { checkedOutAt: "2026-09-01T09:00:00.000Z", checkedInAt: null },
      ],
    });

    expect(entryButton()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getAllByText("Nothing has been checked in yet.").length
    ).toBeGreaterThan(0);
  });
});
