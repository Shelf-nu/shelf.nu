/**
 * Settings and Team tabs, as data: each tab shows exactly when the member
 * holds the permission of the page it opens.
 *
 * @see ./settings-tabs.ts
 */
import type { OrganizationRoles } from "@prisma/client";
import { visibleSettingsTabs, visibleTeamTabs } from "./settings-tabs";

const tabs = (roles: OrganizationRoles[], isPersonalOrg = false) =>
  visibleSettingsTabs({ roles, isPersonalOrg }).map((t) => t.to);
const team = (roles: OrganizationRoles[], isPersonalOrg = false) =>
  visibleTeamTabs({ roles, isPersonalOrg }).map((t) => t.to);

describe("visibleSettingsTabs", () => {
  it.each<[OrganizationRoles]>([["OWNER"], ["ADMIN"]])(
    "%s sees every tab in a team workspace",
    (role) => {
      expect(tabs([role])).toEqual([
        "general",
        "bookings",
        "emails",
        "custom-fields",
        "asset-models",
        "team",
      ]);
    }
  );

  it("personal workspaces hide Bookings and Emails", () => {
    expect(tabs(["OWNER"], true)).toEqual([
      "general",
      "custom-fields",
      "asset-models",
      "team",
    ]);
  });

  it.each<OrganizationRoles[]>([
    ["SELF_SERVICE"],
    ["BASE"],
    [],
    ["BASE", "SELF_SERVICE"],
  ])(
    "%j sees no tab (BASE's read-only asset models and working hours open no editor)",
    (...roles) => {
      expect(tabs(roles)).toEqual([]);
    }
  );

  it("a mixed membership holding ADMIN sees every tab", () => {
    expect(tabs(["SELF_SERVICE", "ADMIN"])).toEqual([
      "general",
      "bookings",
      "emails",
      "custom-fields",
      "asset-models",
      "team",
    ]);
  });
});

describe("visibleTeamTabs", () => {
  it("admins see users, invites and NRMs", () => {
    expect(team(["ADMIN"])).toEqual(["users", "invites", "nrm"]);
  });
  it("personal workspaces have only NRMs", () => {
    expect(team(["OWNER"], true)).toEqual(["nrm"]);
  });
  it("restricted roles see none", () => {
    expect(team(["SELF_SERVICE"])).toEqual([]);
  });
});
