/**
 * AssetImportNotice - unit tests
 *
 * Covers where the notice shows, that it follows the import through the
 * active import endpoint, and that it hides and revalidates once the import
 * is no longer active.
 *
 * @see {@link file://./asset-import-notice.tsx}
 */
import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssetImportNoticePayload,
  AssetImportStatusPayload,
} from "~/modules/asset-import/types";
import { AssetImportNotice } from "./asset-import-notice";

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
    isMine: false,
    ...overrides,
  };
}

/** Makes `GET /api/asset-imports/active` answer with `value`. */
function answerActive(value: AssetImportNoticePayload | null) {
  vi.mocked(fetch).mockResolvedValue({
    json: () => Promise.resolve({ import: value, error: null }),
  } as Response);
}

/** Renders the notice at `path` inside a data router. */
function renderNotice(
  active: AssetImportNoticePayload | null,
  path = "/assets"
) {
  const loader = vi.fn(() => null);
  const Stub = createRoutesStub([
    {
      path: "*",
      loader,
      HydrateFallback: () => null,
      Component: () => (
        <>
          <AssetImportNotice activeAssetImport={active} />
          <span>route ready</span>
        </>
      ),
    },
  ]);
  render(<Stub initialEntries={[path]} />);
  return { loader };
}

beforeEach(() => {
  // why: the notice polls the active import endpoint over the network.
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AssetImportNotice", () => {
  it("shows a running import started by someone else", async () => {
    answerActive(status());
    renderNotice(status());

    expect(
      await screen.findByText(/An import is running \(300 of 965\)/)
    ).toBeInTheDocument();
  });

  it("follows the import's count from the active endpoint", async () => {
    answerActive(status({ processedRows: 900, totalRows: 3000 }));
    renderNotice(status({ processedRows: 100, totalRows: 3000 }));

    expect(
      await screen.findByText(/An import is running \(900 of 3,000\)/)
    ).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/asset-imports/active",
      expect.anything()
    );
  });

  it("hides and revalidates once the import is no longer active", async () => {
    answerActive(null);
    const { loader } = renderNotice(status());

    await screen.findByText("route ready");
    await waitFor(() =>
      expect(screen.queryByText(/An import is running/)).not.toBeInTheDocument()
    );
    // The first call is the initial load, the second the revalidation.
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
  });

  it("renders nothing for a completed import and does not poll", async () => {
    renderNotice(status({ status: "COMPLETED" }));

    await screen.findByText("route ready");
    expect(screen.queryByText(/An import is running/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("also shows with a trailing slash", async () => {
    answerActive(status());
    renderNotice(status(), "/assets/");

    expect(await screen.findByText(/An import is running/)).toBeInTheDocument();
  });

  it("renders nothing off the assets index", async () => {
    renderNotice(status(), "/kits");

    await screen.findByText("route ready");
    expect(screen.queryByText(/An import is running/)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
