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
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChangeRoleDialog } from "./change-role-dialog";

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

/** Opens the role picker and returns the labels it offers. */
function offeredRoles() {
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
  return screen.getAllByRole("option").map((option) => option.textContent);
}

describe("ChangeRoleDialog role options", () => {
  beforeEach(() => {
    viewer.ownsWorkspace = false;
  });

  it("does not offer Administrator to an administrator", () => {
    expect(offeredRoles()).toEqual(["Custody manager", "Self service", "Base"]);
  });

  it("offers Administrator to the workspace owner", () => {
    viewer.ownsWorkspace = true;

    expect(offeredRoles()).toEqual([
      "Administrator",
      "Custody manager",
      "Self service",
      "Base",
    ]);
  });
});
