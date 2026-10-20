/**
 * AssetImportCard - unit tests
 *
 * Covers who sees the card, the progress line and link, the hidden import
 * pages, closing in every state, the auto-dismiss of a finished import, and
 * resilience to a throwing `localStorage`.
 *
 * @see {@link file://./asset-import-card.tsx}
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssetImportStatusPayload } from "~/modules/asset-import/types";
import { AUTO_DISMISS_MS, AssetImportCard } from "./asset-import-card";

// why: the real hook polls the network; the card only needs the status passed in.
vi.mock("../assets/import-content/import-progress", () => ({
  useAssetImportStatus: (_id: string, initial: AssetImportStatusPayload) =>
    initial,
}));

/** A status payload; override what a test cares about. */
function status(
  overrides: Partial<AssetImportStatusPayload> = {}
): AssetImportStatusPayload {
  return {
    id: "abc",
    status: "RUNNING",
    phase: "ROWS",
    fileName: "assets.csv",
    totalRows: 965,
    processedRows: 300,
    errorMessage: null,
    warningCount: 0,
    completedAt: null,
    isMine: true,
    ...overrides,
  };
}

/** Renders the card inside a data router at `path`. */
function renderCard(initial: AssetImportStatusPayload, path = "/assets") {
  const Stub = createRoutesStub([
    { path: "*", Component: () => <AssetImportCard initial={initial} /> },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("AssetImportCard", () => {
  it("renders nothing for an import the viewer did not start", () => {
    const { container } = renderCard(status({ isMine: false }));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the count and links to the status page", async () => {
    renderCard(status());

    expect(await screen.findByText("300 of 965")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View progress" })).toHaveAttribute(
      "href",
      "/assets/import/abc"
    );
  });

  it.each(["/assets/import", "/assets/import/", "/assets/import/abc"])(
    "renders nothing on %s",
    (path) => {
      const { container } = renderCard(status(), path);
      expect(container).toBeEmptyDOMElement();
    }
  );

  it("still shows on the bulk update import page", async () => {
    renderCard(status(), "/assets/import-update");
    expect(await screen.findByText("300 of 965")).toBeInTheDocument();
  });

  it("hides a finished card when it is closed", async () => {
    renderCard(status({ status: "COMPLETED", processedRows: 965 }));

    expect(await screen.findByText("Import complete")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Close import progress" })
    );

    expect(screen.queryByText("Import complete")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("assetImportCard:dismissed")).toBe(
      "abc"
    );
  });

  it("can be closed while the import is running", async () => {
    renderCard(status());

    await screen.findByText("300 of 965");
    fireEvent.click(
      screen.getByRole("button", { name: "Close import progress" })
    );

    expect(screen.queryByText("Importing assets")).not.toBeInTheDocument();
  });

  it("closes a finished card by itself after the delay", async () => {
    vi.useFakeTimers();
    renderCard(status({ status: "COMPLETED", processedRows: 965 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Import complete")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_DISMISS_MS);
    });

    expect(screen.queryByText("Import complete")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("assetImportCard:dismissed")).toBe(
      "abc"
    );
  });

  it("does not close itself while hovered", async () => {
    vi.useFakeTimers();
    renderCard(status({ status: "FAILED", errorMessage: "boom" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    fireEvent.mouseEnter(
      screen.getByRole("region", { name: "Asset import progress" })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_DISMISS_MS * 2);
    });

    expect(screen.getByText("Import stopped")).toBeInTheDocument();
  });

  it("does not close a running import by itself", async () => {
    vi.useFakeTimers();
    renderCard(status());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_DISMISS_MS * 2);
    });

    expect(screen.getByText("Importing assets")).toBeInTheDocument();
  });

  it("still renders and dismisses when localStorage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    renderCard(status({ status: "FAILED", errorMessage: "boom" }));

    expect(await screen.findByText("Import stopped")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Close import progress" })
    );
    expect(screen.queryByText("Import stopped")).not.toBeInTheDocument();
  });

  it("collapses to the header", async () => {
    renderCard(status());

    await screen.findByText("300 of 965");
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse import progress" })
    );

    expect(screen.queryByText("300 of 965")).not.toBeInTheDocument();
    expect(screen.getByText("Importing assets")).toBeInTheDocument();
  });
});
