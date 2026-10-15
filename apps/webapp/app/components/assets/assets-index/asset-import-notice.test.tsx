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
      Component: () => <AssetImportNotice activeAssetImport={active} />,
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
    const { container } = renderNotice(status({ status: "COMPLETED" }));

    // The stub resolves its route asynchronously; wait a tick before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing off the assets index", async () => {
    const { container } = renderNotice(status(), "/kits");

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
