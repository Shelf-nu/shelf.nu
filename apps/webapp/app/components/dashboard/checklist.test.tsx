/**
 * Tests for {@link OnboardingChecklist}: the "Import your assets" item appears
 * only when the home loader says this member may import.
 *
 * @see {@link file://./checklist.tsx}
 */
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import OnboardingChecklist from "./checklist";

/** Nothing on the checklist is done yet. */
const checklistOptions = {
  hasAssets: false,
  hasCustodies: false,
  hasTeamMembers: false,
  hasTags: false,
  hasCategories: false,
  hasCustomFields: false,
};

/**
 * Renders the checklist on `/home` with the home loader's fields it reads.
 *
 * @param canImportAssets - The loader's import flag for this member
 */
async function renderChecklist(canImportAssets: boolean) {
  const Stub = createRoutesStub([
    {
      path: "/home",
      Component: OnboardingChecklist,
      loader: () => ({ checklistOptions, canImportAssets }),
    },
  ]);
  render(<Stub initialEntries={["/home"]} />);
  await screen.findByText(/skip tour/i);
}

describe("OnboardingChecklist import item", () => {
  it("offers the spreadsheet import to a member who may import", async () => {
    await renderChecklist(true);

    expect(screen.getByText("Import your assets")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Import a spreadsheet" })
    ).toHaveAttribute("href", "/assets/import");
  });

  it("leaves the item out for a member who may not import", async () => {
    await renderChecklist(false);

    expect(screen.queryByText("Import your assets")).not.toBeInTheDocument();
  });
});
