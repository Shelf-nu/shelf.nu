/**
 * The role options the change-role dialog offers.
 *
 * Only the workspace owner may grant an owner-only role (Administrator). The
 * server refuses anyone else, so the dialog must not offer it to them either,
 * the same rule the invite dialog applies.
 *
 * @see {@link file://./change-role-dialog.tsx}
 */
import type { ReactNode } from "react";
import { OrganizationRoles } from "@prisma/client";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROLE_DESCRIPTIONS } from "~/utils/permissions/role-access";

import { ChangeRoleDialog } from "./change-role-dialog";
import { ROLES_HELP_URL } from "../settings/roles-help-link";

/** Whether the viewer owns the workspace, per case. */
const viewer = { ownsWorkspace: false };

// why: the dialog's three fetchers load counts and recipients from the server;
// idle stubs with no data keep the render about the role list.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle",
      data: undefined,
      load: vi.fn(),
      submit: vi.fn(),
      Form: ({ children }: { children: ReactNode }) => <form>{children}</form>,
    }),
  };
});

// why: the viewer's access comes from the layout loader in the app.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ ownsWorkspace: viewer.ownsWorkspace }),
}));

/** Opens the role picker and returns the options it offers. */
function openRolePicker() {
  render(
    <ChangeRoleDialog
      userId="member-1"
      currentRoleEnum={OrganizationRoles.BASE}
      currentRoles={[OrganizationRoles.BASE]}
      open
      onOpenChange={() => {}}
    />
  );
  fireEvent.click(document.getElementById("role-select")!);
  return screen.getAllByRole("option");
}

/** Opens the role picker and returns the role names it offers. */
function offeredRoles() {
  return openRolePicker().map(
    (option) =>
      document.getElementById(option.getAttribute("aria-labelledby")!)
        ?.textContent
  );
}

describe("ChangeRoleDialog role options", () => {
  beforeEach(() => {
    viewer.ownsWorkspace = false;
  });

  it("does not offer Administrator to an administrator", () => {
    expect(offeredRoles()).toEqual(["Manager", "Self service", "Base"]);
  });

  it("explains each role under its name and links to the roles article", () => {
    const options = openRolePicker();

    for (const [option, role] of [
      [options[0], "MANAGER"],
      [options[1], "SELF_SERVICE"],
      [options[2], "BASE"],
    ] as const) {
      const description = within(option).getByText(ROLE_DESCRIPTIONS[role]);
      expect(option).toHaveAttribute("aria-describedby", description.id);
    }
    expect(
      screen.getByRole("link", { name: /learn more about roles/i })
    ).toHaveAttribute("href", ROLES_HELP_URL);
  });

  it("offers Administrator to the workspace owner", () => {
    viewer.ownsWorkspace = true;

    expect(offeredRoles()).toEqual([
      "Administrator",
      "Manager",
      "Self service",
      "Base",
    ]);
  });
});
