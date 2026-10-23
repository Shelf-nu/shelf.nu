/**
 * Tests for {@link EmptyState}: the optional secondary link next to the main
 * button. It belongs to the zero-data state only, so a search or a filter
 * that matches nothing shows the clear button and never the secondary link.
 *
 * @see {@link file://./empty-state.tsx}
 */
import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "./empty-state";

// why: the hook reads the asset index's own loader data and cookies; these
// tests only need an empty set of params.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

// why: the hook reads the member's role from the layout loader, which this
// stub router does not run.
vi.mock("~/hooks/use-can-view-archived-assets", () => ({
  useCanViewArchivedAssets: () => true,
}));

const customContent = {
  title: "No assets yet",
  text: "Create your first asset.",
  newButtonRoute: "/assets/new",
  newButtonContent: "Create your first asset",
  secondaryButton: { route: "/assets/import", content: "Import a spreadsheet" },
};

/**
 * Renders the empty state on `/assets` with the list's loader data.
 *
 * @param loaderData - What the list loader returned (search and filter state)
 * @param content - The custom content the page passes in
 */
async function renderEmptyState(
  loaderData: { search: string | null; hasActiveFilters: boolean },
  content: Partial<typeof customContent> = customContent
) {
  const Stub = createRoutesStub([
    {
      path: "/assets",
      Component: () => (
        <EmptyState
          customContent={{ ...customContent, ...content }}
          modelName={{ singular: "asset", plural: "assets" }}
        />
      ),
      loader: () => ({
        ...loaderData,
        modelName: { singular: "asset", plural: "assets" },
      }),
    },
  ]);
  render(<Stub initialEntries={["/assets"]} />);
  // The main control (a link, or a clear button when filtered) renders once
  // the stub's loader has resolved.
  await waitFor(() =>
    expect(document.querySelector("a, button")).not.toBeNull()
  );
}

describe("EmptyState secondary link", () => {
  it("shows the secondary link beside the main button in the zero-data state", async () => {
    await renderEmptyState({ search: null, hasActiveFilters: false });

    expect(
      screen.getByRole("link", { name: "Import a spreadsheet" })
    ).toHaveAttribute("href", "/assets/import");
    // The main button is labelled "new asset" for assistive technology.
    expect(screen.getByRole("link", { name: "new asset" })).toHaveAttribute(
      "href",
      "/assets/new"
    );
  });

  it("leaves it out when the page passes none", async () => {
    await renderEmptyState(
      { search: null, hasActiveFilters: false },
      { secondaryButton: undefined }
    );

    expect(
      screen.queryByRole("link", { name: "Import a spreadsheet" })
    ).not.toBeInTheDocument();
  });

  it("leaves it out when filters match nothing", async () => {
    await renderEmptyState({ search: null, hasActiveFilters: true });

    expect(
      screen.queryByRole("link", { name: "Import a spreadsheet" })
    ).not.toBeInTheDocument();
  });
});
