/**
 * The assets index header: which "New asset" control each member gets.
 *
 * "Managers can edit assets" opens single creation to a Manager. Bulk create
 * from a model answers from the matrix alone, as its route does
 * (`assets.new.tsx`, `matrixOnly: true` for `bulk=1`), so a switched-on
 * Manager gets the plain "New asset" link with no shortcut menu, while an
 * Administrator gets the menu.
 *
 * @see {@link file://./../../../app/routes/_layout+/assets._index.tsx}
 * @see {@link file://./../../../app/components/assets/new-asset-dropdown.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { MemberRoles } from "~/utils/permissions/member-roles";
import { withWorkspaceGrants } from "~/utils/permissions/member-roles";
import AssetIndexPage from "~/routes/_layout+/assets._index";

/** The roles `useOrganizationRoles` hands the page for the current render. */
const caller = vi.hoisted(() => ({
  roles: undefined as MemberRoles | undefined,
}));

// why: the page reads its loader data, which needs a data router; import is
// off so the only shortcut in question is bulk create.
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useLoaderData: () => ({ canImportAssets: false }),
}));

// why: the roles read the `_layout` route loader, which is not mounted here.
// They carry the workspace's switches the way the real hook hands them out.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => caller.roles,
}));

// why: the view state and archived menu read layout loader data and cookies.
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({ modeIsAdvanced: false }),
}));
vi.mock("~/hooks/use-can-view-archived-assets", () => ({
  useCanViewArchivedAssets: () => false,
}));

// why: the empty-state copy reads the URL through a hook that also reads the
// layout loader; plain search params are enough here.
vi.mock("~/hooks/search-params", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/hooks/search-params")>()),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

// why: the list and the header each read route data of their own; the header
// renders its children, which is what this test reads.
vi.mock("~/components/assets/assets-index/assets-list", () => ({
  AssetsList: () => null,
}));
vi.mock("~/components/layout/header", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

// why: importing the route loads the database client, whose connect rejects
// in a DB-less test env; the page component never queries.
vi.mock("~/database/db.server", () => ({ db: {} }));

/** Renders the index page header for `role` with the switch set as given. */
function renderFor(role: OrganizationRoles, managersCanEditAssets: boolean) {
  caller.roles = withWorkspaceGrants([role], { managersCanEditAssets });
  render(
    <MemoryRouter>
      <AssetIndexPage />
    </MemoryRouter>
  );
}

describe("assets index: the New asset control", () => {
  it("gives a switched-on Manager the plain New asset link, without bulk create", () => {
    renderFor(OrganizationRoles.MANAGER, true);

    expect(
      screen.getByRole("link", { name: "new asset" }).getAttribute("href")
    ).toBe("/assets/new");
    expect(
      screen.queryByRole("button", { name: "More create options" })
    ).toBeNull();
  });

  it("offers an Administrator bulk create from a model", async () => {
    renderFor(OrganizationRoles.ADMIN, true);

    await userEvent.click(
      screen.getByRole("button", { name: "More create options" })
    );

    expect(
      screen.getByRole("link", { name: /Bulk create from model/ })
    ).toBeTruthy();
  });
});
