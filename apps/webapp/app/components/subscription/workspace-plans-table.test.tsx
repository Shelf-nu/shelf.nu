/**
 * WorkspacePlansTable - unit tests
 *
 * Pins what an invited member reads on the Subscription page: the plan of a
 * workspace they do not pay for, their own role in it, and who pays.
 *
 * @see {@link file://./workspace-plans-table.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { WorkspacePlanRow } from "~/utils/workspace-plans";
import { WorkspacePlansTable } from "./workspace-plans-table";

/** Builds a workspace row with overridable fields. */
function buildRow(overrides: Partial<WorkspacePlanRow> = {}): WorkspacePlanRow {
  return {
    organizationId: "org-team",
    name: "Acme Studio",
    type: "TEAM",
    imageId: null,
    isCurrent: false,
    roleLabel: "Administrator",
    plan: { tierId: "tier_2", label: "Team" },
    paidBy: { isYou: false, name: "Jordan Lee" },
    ...overrides,
  };
}

/** Returns the table row that contains the given workspace name. */
function getRowFor(name: string) {
  const row = screen.getByText(name).closest("tr");
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe("WorkspacePlansTable", () => {
  it("shows a paid workspace the user is a member of with its plan and owner", () => {
    render(<WorkspacePlansTable rows={[buildRow()]} />);

    const row = within(getRowFor("Acme Studio"));
    expect(row.getByText("Team")).toBeInTheDocument();
    expect(row.getByText("Administrator")).toBeInTheDocument();
    expect(row.getByText("Jordan Lee (owner)")).toBeInTheDocument();
  });

  it("shows 'You' as the payer for a workspace the user owns", () => {
    render(
      <WorkspacePlansTable
        rows={[
          buildRow({
            organizationId: "org-personal",
            name: "Sam's workspace",
            type: "PERSONAL",
            roleLabel: "Owner",
            plan: { tierId: "tier_1", label: "Plus" },
            paidBy: { isYou: true, name: "" },
          }),
        ]}
      />
    );

    const row = within(getRowFor("Sam's workspace"));
    expect(row.getByText("You")).toBeInTheDocument();
    expect(row.getByText("Plus")).toBeInTheDocument();
    expect(row.queryByText(/\(owner\)/)).not.toBeInTheDocument();
  });

  it.each([
    ["a workspace someone else owns", { isYou: false, name: "Jordan Lee" }],
    ["the user's own workspace", { isYou: true, name: "" }],
  ])("shows no payer for a free plan on %s", (_, paidBy) => {
    render(
      <WorkspacePlansTable
        rows={[
          buildRow({
            name: "Free Workspace",
            plan: { tierId: "free", label: "Free" },
            paidBy,
          }),
        ]}
      />
    );

    const row = within(getRowFor("Free Workspace"));
    expect(row.getByText("No one")).toBeInTheDocument();
    expect(row.queryByText(/\(owner\)/)).not.toBeInTheDocument();
    expect(row.queryByText("You")).not.toBeInTheDocument();
  });

  it("offers a Plus upgrade only on the user's own free personal workspace", async () => {
    const onUpgradePersonal = vi.fn();
    render(
      <WorkspacePlansTable
        onUpgradePersonal={onUpgradePersonal}
        rows={[
          buildRow({
            organizationId: "personal",
            name: "Personal workspace",
            type: "PERSONAL",
            roleLabel: "Owner",
            plan: { tierId: "free", label: "Free" },
            paidBy: { isYou: true, name: "" },
          }),
          buildRow({
            organizationId: "free-team",
            name: "Free Team",
            plan: { tierId: "free", label: "Free" },
            paidBy: { isYou: false, name: "Jordan Lee" },
          }),
        ]}
      />
    );

    expect(
      within(getRowFor("Free Team")).queryByRole("button", {
        name: "Upgrade to Plus",
      })
    ).not.toBeInTheDocument();

    await userEvent.click(
      within(getRowFor("Personal workspace")).getByRole("button", {
        name: "Upgrade to Plus",
      })
    );
    expect(onUpgradePersonal).toHaveBeenCalledTimes(1);
  });

  it("marks only the current workspace as current", () => {
    render(
      <WorkspacePlansTable
        rows={[
          buildRow({ isCurrent: true }),
          buildRow({
            organizationId: "org-other",
            name: "Other Co",
            plan: { tierId: "tier_1", label: "Plus" },
          }),
        ]}
      />
    );

    expect(
      within(getRowFor("Acme Studio")).getByText("Current")
    ).toBeInTheDocument();
    expect(
      within(getRowFor("Other Co")).queryByText("Current")
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Current")).toHaveLength(1);
  });

  it("renders nothing when there are no workspaces", () => {
    const { container } = render(<WorkspacePlansTable rows={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
