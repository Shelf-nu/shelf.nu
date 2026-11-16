/**
 * The "New asset" button on the assets index and its shortcut menu.
 *
 * With neither shortcut on offer it is a plain link to `/assets/new`. With
 * one or both, a caret opens a menu holding exactly the shortcuts allowed.
 *
 * @see {@link file://./new-asset-dropdown.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { NewAssetDropdown } from "./new-asset-dropdown";

/** Renders the button with the given shortcuts allowed. */
function renderDropdown(props: {
  canImportAssets: boolean;
  canBulkCreate: boolean;
}) {
  render(
    <MemoryRouter>
      <NewAssetDropdown {...props} />
    </MemoryRouter>
  );
}

/** Opens the shortcut menu and returns the shortcut links it shows. */
async function openShortcuts() {
  await userEvent.click(
    screen.getByRole("button", { name: "More create options" })
  );
  return screen
    .getAllByRole("link")
    .map((link) => link.getAttribute("href"))
    .filter((href) => href !== "/assets/new");
}

describe("NewAssetDropdown", () => {
  it("renders a plain New asset link when neither shortcut is allowed", () => {
    renderDropdown({ canImportAssets: false, canBulkCreate: false });

    expect(
      screen.getByRole("link", { name: "new asset" }).getAttribute("href")
    ).toBe("/assets/new");
    expect(
      screen.queryByRole("button", { name: "More create options" })
    ).toBeNull();
  });

  it("offers only bulk create when import is not allowed", async () => {
    renderDropdown({ canImportAssets: false, canBulkCreate: true });

    expect(await openShortcuts()).toEqual(["/assets/new?bulk=1"]);
  });

  it("offers only import when bulk create is not allowed", async () => {
    renderDropdown({ canImportAssets: true, canBulkCreate: false });

    expect(await openShortcuts()).toEqual(["/assets/import"]);
  });
});
