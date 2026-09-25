/**
 * Sidebar items per membership: admin areas, Team and Workspace settings show
 * with the matrix grant of the page they open, so a membership that holds
 * ADMIN or OWNER beside a restricted role sees the admin areas.
 *
 * @see {@link file://./use-sidebar-nav-items.tsx}
 */
import type { OrganizationRoles } from "@prisma/client";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavItem } from "./use-sidebar-nav-items";
import { useSidebarNavItems } from "./use-sidebar-nav-items";
import { useUserRoleHelper } from "./user-user-role-helper";

// why: the layout loader supplies nav data; no data router is mounted here
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: vi.fn(() => ({
      isAdmin: false,
      canUseBookings: true,
      subscription: null,
      unreadUpdatesCount: 0,
    })),
  };
});

// why: organization comes from layout data, which is not mounted here
vi.mock("./use-current-organization", () => ({
  useCurrentOrganization: vi.fn(() => ({ type: "TEAM" })),
}));

// why: roles come from the layout loader, which is not mounted here
vi.mock("./user-user-role-helper", () => ({
  useUserRoleHelper: vi.fn(),
}));

/** Titles of the visible top items, plus `Parent/Child` for visible children. */
function titles(items: NavItem[]): string[] {
  return items
    .filter((item) => !item.hidden)
    .flatMap((item) =>
      item.type === "parent"
        ? [
            item.title,
            ...item.children
              .filter((child) => !child.hidden)
              .map((child) => `${item.title}/${child.title}`),
          ]
        : [item.title]
    );
}

function sidebarFor(roles: OrganizationRoles[]): string[] {
  vi.mocked(useUserRoleHelper).mockReturnValue({ roles } as ReturnType<
    typeof useUserRoleHelper
  >);
  return titles(
    renderHook(() => useSidebarNavItems()).result.current.topMenuItems
  );
}

const ADMIN_VIEW = [
  "Asset management",
  "Home",
  "Assets",
  "Kits",
  "Categories",
  "Tags",
  "Locations",
  "Audits",
  "Bookings",
  "Bookings/View Bookings",
  "Bookings/Calendar",
  "Reminders",
  "Reports",
  "Organization",
  "Team",
  "Team/Users",
  "Team/Pending invites",
  "Team/Non-registered members",
  "Workspace settings",
  "Workspace settings/General",
  "Workspace settings/Bookings",
  "Workspace settings/Custom fields",
  "Workspace settings/Asset models",
];

const RESTRICTED_VIEW = [
  "Asset management",
  "Assets",
  "Kits",
  "Audits",
  "Bookings",
  "Bookings/View Bookings",
  "Bookings/Calendar",
];

describe("useSidebarNavItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([[["OWNER"]], [["ADMIN"]]] as OrganizationRoles[][][])(
    "%s sees every admin area",
    (roles) => {
      expect(sidebarFor(roles)).toEqual(ADMIN_VIEW);
    }
  );

  it.each([[["SELF_SERVICE"]], [["BASE"]]] as OrganizationRoles[][][])(
    "%s sees assets, kits, audits and bookings only",
    (roles) => {
      expect(sidebarFor(roles)).toEqual(RESTRICTED_VIEW);
    }
  );

  it("a membership holding ADMIN beside SELF_SERVICE sees what ADMIN sees", () => {
    expect(sidebarFor(["SELF_SERVICE", "ADMIN"])).toEqual(ADMIN_VIEW);
  });
});
