/**
 * Team member row actions: which controls lock, per caller and target.
 *
 * Pins the caller half of the rule the server enforces in
 * `resolveUserAction`: only a member who owns the workspace (OWNER anywhere in
 * their membership) may change, revoke or re-invite a member whose effective
 * role needs the owner. A locked control stays in the menu with its reason
 * (`aria-disabled`), an open one is a plain enabled button.
 *
 * Also pins where "Log out of Shelf" appears (SSO workspace, SSO member whose
 * email domain is the workspace's SSO domain) and
 * when it locks (yourself, the workspace owner), mirroring
 * `assertCanLogoutMember`.
 *
 * @see {@link file://./users-actions-dropdown.tsx}
 * @see {@link file://./../../modules/user/utils.server.ts}
 */
import type { ReactNode } from "react";
import { OrganizationRoles } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useRoleAccess } from "~/hooks/use-role-access";
import {
  ROLE_LABELS,
  resolveRoleAccess,
} from "~/utils/permissions/role-access";
import { TeamUsersActionsDropdown } from "./users-actions-dropdown";

// why: the menu posts through a fetcher and reads navigation state, both of
// which need a data router; only the rendered controls are under test
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle",
      Form: ({ children }: { children: ReactNode }) => <form>{children}</form>,
    }),
    useNavigation: () => ({ state: "idle" }),
  };
});

// why: the signed-in member's access comes from the `_layout` loader; each
// case supplies the caller's resolved access directly
vi.mock("~/hooks/use-role-access", () => ({ useRoleAccess: vi.fn() }));

// why: the workspace's SSO flag comes from the `_layout` loader; each case
// sets it directly
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: vi.fn(),
}));

// why: the logout dialog posts through its own fetcher and is closed here
vi.mock("./logout-user-dialog", () => ({ LogoutUserDialog: () => null }));

// why: the current user comes from the root loader; a different id keeps the
// "your own role" lock out of every case
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "signed-in-user" }),
}));

// why: renders the menu content without Radix's open state, pointer handling
// and portal, so the controls can be read directly
vi.mock("~/components/shared/dropdown", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

// why: the menu's open state reads search params through the router; the
// content is rendered regardless by the dropdown stub above
vi.mock("~/hooks/use-controlled-dropdown-menu", () => ({
  useControlledDropdownMenu: () => ({
    ref: { current: null },
    open: true,
    setOpen: vi.fn(),
  }),
}));

// why: the change-role dialog loads team data of its own and is closed here
vi.mock("./change-role-dialog", () => ({ ChangeRoleDialog: () => null }));

/** Renders the row menu of `target` as seen by a caller holding `callerRoles`. */
function renderMenu({
  callerRoles,
  target,
  inviteStatus,
  targetRoles = [target],
  targetUserId = "target-user",
  isSSO = false,
  enabledSso = false,
  email = "target@example.com",
}: {
  callerRoles: readonly OrganizationRoles[];
  target: OrganizationRoles;
  inviteStatus: "ACCEPTED" | "PENDING";
  targetRoles?: OrganizationRoles[];
  targetUserId?: string;
  isSSO?: boolean;
  enabledSso?: boolean;
  email?: string;
}) {
  vi.mocked(useCurrentOrganization).mockReturnValue({
    enabledSso,
    ssoDetails: { domain: "example.com" },
  } as ReturnType<typeof useCurrentOrganization>);
  vi.mocked(useRoleAccess).mockReturnValue(
    resolveRoleAccess({
      roles: callerRoles,
      workspace: {
        selfServiceCanSeeBookings: false,
        baseUserCanSeeBookings: false,
        selfServiceCanSeeCustody: false,
        baseUserCanSeeCustody: false,
        managersCanEditAssets: false,
      },
    })
  );
  render(
    <TeamUsersActionsDropdown
      userId={inviteStatus === "ACCEPTED" ? targetUserId : null}
      inviteStatus={inviteStatus}
      name="Target"
      teamMemberId="tm-1"
      email={email}
      isSSO={isSSO}
      role={ROLE_LABELS[target]}
      roleEnum={target}
      roles={targetRoles}
    />
  );
}

/** Whether a control is locked with a reason (rendered `aria-disabled`). */
function isLocked(name: RegExp) {
  return (
    screen.getByRole("button", { name }).getAttribute("aria-disabled") ===
    "true"
  );
}

const R = OrganizationRoles;

describe("TeamUsersActionsDropdown: owner-only targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["ADMIN", R.ADMIN, true, [R.ADMIN]],
    ["ADMIN+SELF_SERVICE", R.ADMIN, true, [R.ADMIN, R.SELF_SERVICE]],
    ["OWNER", R.ADMIN, false, [R.OWNER]],
    ["OWNER+ADMIN", R.ADMIN, false, [R.OWNER, R.ADMIN]],
    ["ADMIN+OWNER", R.ADMIN, false, [R.ADMIN, R.OWNER]],
    ["ADMIN", R.SELF_SERVICE, false, [R.ADMIN]],
    ["ADMIN", R.BASE, false, [R.ADMIN]],
  ] as const)(
    "caller %s on a %s member: change role and revoke locked = %s",
    (_label, target, locked, callerRoles) => {
      renderMenu({ callerRoles, target, inviteStatus: "ACCEPTED" });

      expect(isLocked(/change role/i)).toBe(locked);
      expect(isLocked(/revoke access/i)).toBe(locked);
    }
  );

  it.each([
    ["ADMIN", R.ADMIN, false, [R.ADMIN]],
    ["ADMIN+OWNER", R.ADMIN, false, [R.ADMIN, R.OWNER]],
    ["OWNER", R.ADMIN, false, [R.OWNER]],
    ["ADMIN", R.SELF_SERVICE, false, [R.ADMIN]],
  ] as const)(
    "caller %s resending a %s invite: locked = %s",
    (_label, target, locked, callerRoles) => {
      renderMenu({ callerRoles, target, inviteStatus: "PENDING" });

      expect(isLocked(/resend invite/i)).toBe(locked);
      // Cancelling an invite grants nothing, so it never locks
      expect(isLocked(/cancel invite/i)).toBe(false);
    }
  );
});

describe("TeamUsersActionsDropdown: log out of Shelf", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const logoutButton = () =>
    screen.queryByRole("button", { name: /log out of shelf/i });

  it.each([
    ["a workspace without SSO", { enabledSso: false, isSSO: true }],
    [
      "a member who does not sign in through SSO",
      { enabledSso: true, isSSO: false },
    ],
    [
      "an SSO member from another company's identity provider",
      { enabledSso: true, isSSO: true, email: "jane@othercompany.com" },
    ],
  ])("is not offered for %s", (_label, flags) => {
    renderMenu({
      callerRoles: [R.ADMIN],
      target: R.BASE,
      inviteStatus: "ACCEPTED",
      ...flags,
    });

    expect(logoutButton()).toBeNull();
  });

  it.each([
    ["ADMIN", R.ADMIN, [R.ADMIN]],
    ["ADMIN", R.SELF_SERVICE, [R.ADMIN]],
    ["OWNER", R.ADMIN, [R.OWNER]],
  ] as const)(
    "caller %s may log out an SSO %s member",
    (_label, target, callerRoles) => {
      renderMenu({
        callerRoles,
        target,
        inviteStatus: "ACCEPTED",
        isSSO: true,
        enabledSso: true,
      });

      expect(isLocked(/log out of shelf/i)).toBe(false);
    }
  );

  it("is locked on the workspace owner", () => {
    renderMenu({
      callerRoles: [R.ADMIN],
      target: R.ADMIN,
      targetRoles: [R.ADMIN, R.OWNER],
      inviteStatus: "ACCEPTED",
      isSSO: true,
      enabledSso: true,
    });

    expect(isLocked(/log out of shelf/i)).toBe(true);
  });

  it("is locked on the signed-in member themselves", () => {
    renderMenu({
      callerRoles: [R.ADMIN],
      target: R.ADMIN,
      targetUserId: "signed-in-user",
      inviteStatus: "ACCEPTED",
      isSSO: true,
      enabledSso: true,
    });

    expect(isLocked(/log out of shelf/i)).toBe(true);
  });
});
