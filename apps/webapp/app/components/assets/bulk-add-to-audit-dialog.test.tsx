/**
 * `BulkAddToAuditDialog` empty state: what a member sees when no pending audit
 * is open to them.
 *
 * Base and Self Service members reach this dialog (it needs `audit: update`)
 * but cannot create audits, so they must be told to ask for an assignment
 * rather than offered a "Create new audit" button that leads nowhere.
 *
 * @see {@link file://./bulk-add-to-audit-dialog.tsx}
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { useOrganizationRoles } from "~/hooks/use-organization-roles";

import BulkAddToAuditDialog from "./bulk-add-to-audit-dialog";

// why: the layout loader supplies the roles, and it is not mounted here
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: vi.fn(),
}));

// why: the pending-audit list comes from an API route; the empty answer is
// the state under test
vi.mock("~/hooks/use-api-query", () => ({
  default: () => ({ data: { audits: [] }, isLoading: false, error: null }),
}));

// why: the index loader supplies the item total, and it is not mounted here
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useLoaderData: () => ({ totalItems: 1 }) };
});

// why: the shared dialog shell owns the fetcher and open state; only the
// render-prop body this file supplies is under test
vi.mock("../bulk-update-dialog/bulk-update-dialog", () => ({
  BulkUpdateDialogContent: ({
    children,
  }: {
    children: (args: {
      fetcherError: null;
      fetcherData: null;
      disabled: boolean;
      handleCloseDialog: () => void;
    }) => ReactNode;
  }) => (
    <div>
      {children({
        fetcherError: null,
        fetcherData: null,
        disabled: false,
        handleCloseDialog: () => {},
      })}
    </div>
  ),
}));

function renderDialog() {
  return render(
    <MemoryRouter>
      <BulkAddToAuditDialog />
    </MemoryRouter>
  );
}

describe("BulkAddToAuditDialog empty state", () => {
  it("offers to create an audit to a role that can create one", () => {
    vi.mocked(useOrganizationRoles).mockReturnValue(["ADMIN"]);

    renderDialog();

    expect(screen.getByText("Create new audit")).toBeInTheDocument();
    expect(
      screen.queryByText(/Ask an administrator to assign you/)
    ).not.toBeInTheDocument();
  });

  it.each(["BASE", "SELF_SERVICE"] as const)(
    "tells %s to ask for an assignment instead of offering to create",
    (role) => {
      vi.mocked(useOrganizationRoles).mockReturnValue([role]);

      renderDialog();

      expect(screen.queryByText("Create new audit")).not.toBeInTheDocument();
      expect(
        screen.getByText(/Ask an administrator to assign you to an audit/)
      ).toBeInTheDocument();
    }
  );
});
