/**
 * Custody Column UI Tests
 *
 * Behavior tests for the multi-custodian rendering on the advanced
 * asset index. Verifies the four rendering branches (empty, single
 * with quantity 1, single with quantity > 1, multiple custodians) and
 * the tooltip listing every custodian on its own line.
 *
 * @see {@link file://./advanced-asset-columns.tsx}
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdvancedIndexAsset } from "~/modules/asset/types";

// why: lottie-web touches canvas APIs that jsdom doesn't fully
// implement, blowing up at module-import time when the asset-columns
// barrel transitively pulls in the scanner success animation.
vi.mock("lottie-react", () => ({
  default: () => null,
}));

// why: TeamMemberBadge depends on useCurrentOrganization, useUserData
// and a permission helper that all hit Remix-internal context. Stub it
// to a deterministic span so the test focuses on the column's own
// rendering decisions.
vi.mock("~/components/user/team-member-badge", () => ({
  TeamMemberBadge: ({
    teamMember,
  }: {
    teamMember: { name: string } | null | undefined;
  }) => <span data-testid="team-member-badge">{teamMember?.name ?? ""}</span>,
}));

// why: useUserRoleHelper resolves roles via Remix loader data; tests do
// not run inside a route, so we stub it to a single-role admin set.
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({ roles: ["ADMIN"] }),
}));

// why: permission gating defaults to allow so the column always
// renders; the column's permission gate is exercised elsewhere.
vi.mock("~/utils/permissions/permission.validator.client", () => ({
  userHasPermission: () => true,
}));

// why: When wraps children in a fragment when truthy; replicate that
// minimal contract instead of pulling in the real component which
// imports more of the layout shell.
vi.mock("~/components/when/when", () => ({
  __esModule: true,
  default: ({ truthy, children }: { truthy: boolean; children: ReactNode }) =>
    truthy ? <>{children}</> : null,
}));

import { CustodyColumn } from "./advanced-asset-columns";

/** Wraps the column's `<td>` in the table structure required by JSX
 * validity in jsdom; the column itself only renders the cell. */
function renderCell(custody: AdvancedIndexAsset["custody"]) {
  return render(
    <table>
      <tbody>
        <tr>
          <CustodyColumn custody={custody} />
        </tr>
      </tbody>
    </table>
  );
}

/** Build a custody entry shaped like the AdvancedIndexAsset SQL
 * projection — both `name` (top-level) and `custodian.name` (nested)
 * are present because the projection emits both. */
function makeCustody(
  name: string,
  quantity?: number
): NonNullable<AdvancedIndexAsset["custody"]>[number] {
  return {
    name,
    quantity,
    custodian: {
      name,
      user: null,
    },
  };
}

describe("CustodyColumn", () => {
  it("renders the empty placeholder when custody is null", () => {
    renderCell(null);

    expect(screen.getByLabelText("No data")).toBeInTheDocument();
    expect(screen.queryByTestId("team-member-badge")).not.toBeInTheDocument();
  });

  it("renders the empty placeholder when custody is an empty array", () => {
    renderCell([]);

    expect(screen.getByLabelText("No data")).toBeInTheDocument();
  });

  it("renders a single badge with no quantity suffix when quantity is 1", () => {
    renderCell([makeCustody("Alice", 1)]);

    const badge = screen.getByTestId("team-member-badge");
    expect(badge).toHaveTextContent("Alice");

    // No "(N)" suffix should appear for quantity <= 1.
    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument();
    // No "+N more" chip with a single custodian.
    expect(screen.queryByTestId("custody-more-chip")).not.toBeInTheDocument();
  });

  it("renders a single badge with a (quantity) suffix when quantity > 1", () => {
    renderCell([makeCustody("Alice", 5)]);

    expect(screen.getByTestId("team-member-badge")).toHaveTextContent("Alice");
    expect(screen.getByText("(5)")).toBeInTheDocument();
  });

  it("omits the suffix when quantity is undefined (booking-derived custody)", () => {
    // Booking-derived synthetic custody emits no `quantity`; the row
    // should render like an INDIVIDUAL asset.
    renderCell([makeCustody("Alice")]);

    expect(screen.getByTestId("team-member-badge")).toHaveTextContent("Alice");
    expect(screen.queryByText(/\(\d+\)/)).not.toBeInTheDocument();
  });

  it("renders the primary badge plus a +N more chip for multiple custodians", () => {
    renderCell([
      makeCustody("Alice", 4),
      makeCustody("Bob", 7),
      makeCustody("Carol", 1),
    ]);

    // Primary badge shows up with its quantity suffix
    expect(screen.getByTestId("team-member-badge")).toHaveTextContent("Alice");
    expect(screen.getByText("(4)")).toBeInTheDocument();

    // Chip indicates 2 additional custodians
    const chip = screen.getByTestId("custody-more-chip");
    expect(chip).toHaveTextContent("+2 more");
  });

  it("lists every custodian with their quantity in the tooltip on hover", async () => {
    const user = userEvent.setup();

    renderCell([
      makeCustody("Alice", 4),
      makeCustody("Bob", 7),
      makeCustody("Carol", 1),
    ]);

    const chip = screen.getByTestId("custody-more-chip");
    await user.hover(chip);

    // The tooltip is portalled; assert via findBy which polls.
    const tooltip = await screen.findByTestId("custody-more-tooltip");
    expect(tooltip).toHaveTextContent("Alice (4)");
    expect(tooltip).toHaveTextContent("Bob (7)");
    // Carol has quantity 1 so the suffix is suppressed; the name is
    // still listed.
    expect(tooltip).toHaveTextContent("Carol");
    expect(tooltip).not.toHaveTextContent("Carol (1)");
  });
});
