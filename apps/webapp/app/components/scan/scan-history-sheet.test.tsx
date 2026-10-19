/**
 * The scan history sheet: opening it loads the first page, "Load more"
 * appends the next one, a failure keeps the rows already shown, and a
 * reopened sheet never shows what an earlier opening loaded.
 *
 * The payloads are built with the same `toScanHistoryRow` the route uses, so
 * this consumer and the route test pin one shape between them.
 *
 * @see {@link file://./scan-history-sheet.tsx}
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createScanWithRelations } from "@factories";
import type { ScanHistoryPage } from "~/modules/scan/history.server";
import { toScanHistoryRow } from "~/modules/scan/history.server";

/** The fetcher the sheet sees; each test drives its state and data. */
const fetcher = {
  state: "idle" as "idle" | "loading",
  data: undefined as unknown,
  load: vi.fn(),
};

// why: the fetcher talks to the route; these tests control what it returns.
vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useFetcher: () => fetcher };
});

// why: DateS reads client hints from route context unavailable here; the raw
// value is enough to tell rows apart.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: string }) => <span>{date}</span>,
}));

import { ScanHistoryButton } from "./scan-history-sheet";

/** A page of rows with the given ids. */
function page(ids: string[], nextCursor: string | null) {
  return {
    error: null,
    scans: ids.map((id) =>
      toScanHistoryRow(
        createScanWithRelations({ id, codeType: "BARCODE", code: `BC-${id}` })
      )
    ),
    nextCursor,
  } satisfies ScanHistoryPage & { error: null };
}

function renderSheet() {
  return render(
    <ScanHistoryButton target={{ assetId: "asset-1" }} itemName="Laptop" />,
    { wrapper: MemoryRouter }
  );
}

/** Delivers a response to the sheet, as the fetcher does when it settles. */
function respond(rerender: () => void, data: unknown) {
  act(() => {
    fetcher.state = "idle";
    fetcher.data = data;
    rerender();
  });
}

beforeEach(() => {
  fetcher.state = "idle";
  fetcher.data = undefined;
  fetcher.load.mockReset();
});

describe("ScanHistoryButton", () => {
  it("loads the first page of the asset's scans when opened", async () => {
    const view = renderSheet();

    await userEvent.click(
      screen.getByRole("button", { name: "View all scans" })
    );

    expect(fetcher.load).toHaveBeenCalledWith("/api/scans?assetId=asset-1");
    respond(
      () =>
        view.rerender(
          <ScanHistoryButton
            target={{ assetId: "asset-1" }}
            itemName="Laptop"
          />
        ),
      page(["1", "2"], null)
    );

    expect(screen.getByText("Barcode: BC-1")).toBeInTheDocument();
    expect(screen.getByText("Barcode: BC-2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("appends the next page once, after the rows already shown", async () => {
    const view = renderSheet();
    const rerender = () =>
      view.rerender(
        <ScanHistoryButton target={{ assetId: "asset-1" }} itemName="Laptop" />
      );

    await userEvent.click(
      screen.getByRole("button", { name: "View all scans" })
    );
    respond(rerender, page(["1"], "1"));

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(fetcher.load).toHaveBeenLastCalledWith(
      "/api/scans?assetId=asset-1&cursor=1"
    );
    // The first page is still in fetcher.data until the next one arrives; it
    // must not be appended a second time.
    act(() => rerender());
    expect(screen.getAllByText("Barcode: BC-1")).toHaveLength(1);

    respond(rerender, page(["2"], null));
    expect(screen.getByText("Barcode: BC-1")).toBeInTheDocument();
    expect(screen.getByText("Barcode: BC-2")).toBeInTheDocument();
  });

  it("says when the asset has never been scanned", async () => {
    const view = renderSheet();

    await userEvent.click(
      screen.getByRole("button", { name: "View all scans" })
    );
    respond(
      () =>
        view.rerender(
          <ScanHistoryButton
            target={{ assetId: "asset-1" }}
            itemName="Laptop"
          />
        ),
      page([], null)
    );

    expect(screen.getByText("Not scanned yet")).toBeInTheDocument();
  });

  it("keeps the rows shown and offers a retry when a page fails", async () => {
    const view = renderSheet();
    const rerender = () =>
      view.rerender(
        <ScanHistoryButton target={{ assetId: "asset-1" }} itemName="Laptop" />
      );

    await userEvent.click(
      screen.getByRole("button", { name: "View all scans" })
    );
    respond(rerender, page(["1"], "1"));
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    respond(rerender, { error: { message: "Boom" } });

    expect(screen.getByText("Barcode: BC-1")).toBeInTheDocument();
    expect(screen.getByText("Boom")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(fetcher.load).toHaveBeenLastCalledWith(
      "/api/scans?assetId=asset-1&cursor=1"
    );
  });

  it("shows only the fresh first page after closing and reopening", async () => {
    const view = renderSheet();
    const rerender = () =>
      view.rerender(
        <ScanHistoryButton target={{ assetId: "asset-1" }} itemName="Laptop" />
      );

    await userEvent.click(
      screen.getByRole("button", { name: "View all scans" })
    );
    respond(rerender, page(["old"], null));
    expect(screen.getByText("Barcode: BC-old")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await userEvent.click(
      screen.getByRole("button", { name: "View all scans" })
    );

    // The previous opening's page is still on the fetcher; it must not be
    // taken for the answer to this opening's request.
    act(() => rerender());
    expect(screen.queryByText("Barcode: BC-old")).toBeNull();

    respond(rerender, page(["fresh"], null));
    expect(screen.getByText("Barcode: BC-fresh")).toBeInTheDocument();
    expect(screen.queryByText("Barcode: BC-old")).toBeNull();
  });
});
