/**
 * The role picker in the "Invite team members" dialog.
 *
 * Each role it offers carries the one-sentence explanation from
 * `ROLE_DESCRIPTIONS`, and the roles article is linked below the picker.
 *
 * @see {@link file://./invite-user-dialog.tsx}
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from "~/utils/permissions/role-access";

import InviteUserDialog from "./invite-user-dialog";
import { ROLES_HELP_URL } from "./roles-help-link";

// why: the dialog's fetcher form posts to the invite route, which needs a data
// router; an idle stub keeps the render about the role picker.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle",
      data: undefined,
      submit: vi.fn(),
      Form: ({ children }: { children: ReactNode }) => <form>{children}</form>,
    }),
  };
});

// why: the workspace comes from the layout loader, which is not mounted here.
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => ({
    id: "org-1",
    name: "Acme",
    imageId: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  }),
}));

// why: the viewer's access comes from the layout loader in the app; a
// non-owner administrator may invite every invitable role.
vi.mock("~/hooks/use-role-access", () => ({
  useRoleAccess: () => ({ ownsWorkspace: false }),
}));

/** Opens the dialog's role picker and returns the options it offers. */
function openRolePicker() {
  render(<InviteUserDialog open />);
  const trigger = within(screen.getByRole("group", { name: "Role" })).getByRole(
    "combobox"
  );
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getAllByRole("option");
}

describe("InviteUserDialog role picker", () => {
  it("explains each role it offers under the role's name", () => {
    const options = openRolePicker();

    expect(options).toHaveLength(4);
    for (const [option, role] of [
      [options[0], "ADMIN"],
      [options[1], "MANAGER"],
      [options[2], "SELF_SERVICE"],
      [options[3], "BASE"],
    ] as const) {
      expect(within(option).getByText(ROLE_LABELS[role])).toBeInTheDocument();
      expect(
        within(option).getByText(ROLE_DESCRIPTIONS[role])
      ).toBeInTheDocument();
    }
  });

  it("links to the roles article", () => {
    render(<InviteUserDialog open />);

    expect(
      screen.getByRole("link", { name: /learn more about roles/i })
    ).toHaveAttribute("href", ROLES_HELP_URL);
  });
});
