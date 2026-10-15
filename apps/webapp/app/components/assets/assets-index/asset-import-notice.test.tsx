/**
 * AssetImportNotice - unit tests
 *
 * @see {@link file://./asset-import-notice.tsx}
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { AssetImportStatusPayload } from "~/modules/asset-import/types";
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

/** Renders the notice at `path` inside a data router. */
function renderNotice(
  active: AssetImportStatusPayload | null,
  path = "/assets"
) {
  const Stub = createRoutesStub([
    {
      path: "*",
      Component: () => (
        <>
          <AssetImportNotice activeAssetImport={active} />
          <span>route ready</span>
        </>
      ),
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

describe("AssetImportNotice", () => {
  it("shows a running import started by someone else", async () => {
    renderNotice(status());

    expect(
      await screen.findByText(/An import is running \(300 of 965\)/)
    ).toBeInTheDocument();
  });

  it("renders nothing for a completed import", async () => {
    renderNotice(status({ status: "COMPLETED" }));

    await screen.findByText("route ready");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("also shows with a trailing slash", async () => {
    renderNotice(status(), "/assets/");

    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("renders nothing off the assets index", async () => {
    renderNotice(status(), "/kits");

    await screen.findByText("route ready");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
