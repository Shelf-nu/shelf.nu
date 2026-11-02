/**
 * The applied-filter chips and the notice for filters a link named but the
 * report could not apply.
 *
 * @see {@link file://./active-filter-chips.tsx}
 */

import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import type { ActiveReportFilter } from "~/modules/reports/types";
import { ActiveFilterChips } from "./active-filter-chips";

/** Renders the chips inside a data router, which `useSearchParams` needs. */
function renderChips(filters: ActiveReportFilter[], ignoredCount: number) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ActiveFilterChips filters={filters} ignoredCount={ignoredCount} />
      ),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
}

describe("ActiveFilterChips", () => {
  it("says a link's filters were left out even when none applied", async () => {
    renderChips([], 2);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "2 filters in this link no longer exist and were left out."
    );
    // Nothing is applied, so there is nothing to clear.
    expect(
      screen.queryByRole("button", { name: "Clear all filters" })
    ).toBeNull();
  });

  it("shows the chips and no notice when every filter applied", async () => {
    renderChips(
      [
        {
          type: "category",
          param: "category",
          value: "cat-1",
          label: "Category: Cameras",
        },
      ],
      0
    );

    expect(await screen.findByText("Category: Cameras")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
