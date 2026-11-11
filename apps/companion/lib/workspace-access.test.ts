/**
 * Tests for the workspace access helpers: landing skips an inactive
 * workspace, a refresh keeps the open one, and the switcher and scanner read
 * the server's marks.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Organization } from "./api/types";
import {
  activeTeamWorkspaces,
  inactiveWorkspaceMessage,
  tabShowsInactiveScreen,
  workspaceInactiveScanResult,
  isWorkspaceInactive,
  isWorkspaceInactiveRefusal,
  pickLandingOrg,
  refreshOpenOrg,
  workspaceSwitchLabel,
} from "./workspace-access";

/** A workspace as `/api/mobile/me` sends it. */
function org(id: string, inactive?: boolean): Organization {
  return {
    id,
    name: id,
    type: "TEAM",
    roles: ["ADMIN"],
    barcodesEnabled: false,
    auditsEnabled: false,
    ...(inactive === undefined
      ? {}
      : {
          inactive,
          inactiveReason: inactive ? "lapsed" : null,
          inactiveMessage: inactive ? `${id} is inactive.` : null,
        }),
  };
}

describe("isWorkspaceInactive", () => {
  test("reads only the server's mark", () => {
    assert.equal(isWorkspaceInactive(org("a", true)), true);
    assert.equal(isWorkspaceInactive(org("a", false)), false);
    // A server without the field: every workspace is active there.
    assert.equal(isWorkspaceInactive(org("a")), false);
    assert.equal(isWorkspaceInactive(null), false);
  });
});

describe("pickLandingOrg", () => {
  const orgs = [
    org("personal", false),
    org("lapsed", true),
    org("team", false),
  ];

  test("opens the preferred workspace when it is active", () => {
    assert.equal(pickLandingOrg(orgs, ["team", "personal"])?.id, "team");
  });

  test("passes over an inactive device choice for the next preference", () => {
    assert.equal(pickLandingOrg(orgs, ["lapsed", "team"])?.id, "team");
  });

  test("passes over an inactive choice for the first active workspace in server order", () => {
    assert.equal(pickLandingOrg(orgs, ["lapsed", null])?.id, "personal");
  });

  test("opens the first choice when every workspace is inactive", () => {
    const allInactive = [org("x", true), org("y", true)];
    assert.equal(pickLandingOrg(allInactive, ["y"])?.id, "y");
    assert.equal(pickLandingOrg(allInactive, [])?.id, "x");
  });

  test("ignores ids that are not in the list, and answers null for no workspace", () => {
    assert.equal(pickLandingOrg(orgs, ["gone", undefined])?.id, "personal");
    assert.equal(pickLandingOrg([], ["a"]), null);
  });
});

describe("refreshOpenOrg", () => {
  test("keeps the same object while the active state is unchanged", () => {
    const live = org("a", false);
    assert.equal(refreshOpenOrg(live, [org("a", false)]), live);
  });

  test("takes the fresh object when the workspace became inactive, and keeps it open", () => {
    const fresh = org("a", true);
    assert.equal(
      refreshOpenOrg(org("a", false), [org("b", false), fresh]),
      fresh
    );
  });

  test("takes the fresh object when the workspace became active again", () => {
    const fresh = org("a", false);
    assert.equal(refreshOpenOrg(org("a", true), [fresh]), fresh);
  });

  test("answers null when the workspace is gone", () => {
    assert.equal(refreshOpenOrg(org("a", false), [org("b", false)]), null);
  });
});

describe("workspaceSwitchLabel", () => {
  test("marks inactive and current workspaces", () => {
    assert.equal(workspaceSwitchLabel(org("Team", false), "x"), "Team");
    assert.equal(
      workspaceSwitchLabel(org("Team", true), "x"),
      "Team (inactive)"
    );
    assert.equal(
      workspaceSwitchLabel(org("Team", false), "Team"),
      "Team (current)"
    );
    assert.equal(
      workspaceSwitchLabel(org("Team", true), "Team"),
      "Team (inactive, current)"
    );
  });
});

describe("inactiveWorkspaceMessage", () => {
  test("shows the server's message, or a plain fallback", () => {
    assert.equal(inactiveWorkspaceMessage(org("a", true)), "a is inactive.");
    assert.match(
      inactiveWorkspaceMessage({ inactiveMessage: null }),
      /^This workspace is inactive\./
    );
  });
});

describe("isWorkspaceInactiveRefusal", () => {
  test("recognises the scan lookups' reason only", () => {
    assert.equal(
      isWorkspaceInactiveRefusal({ reason: "workspace_inactive" }),
      true
    );
    assert.equal(isWorkspaceInactiveRefusal({ reason: "unclaimed" }), false);
    assert.equal(isWorkspaceInactiveRefusal({}), false);
    assert.equal(isWorkspaceInactiveRefusal(null), false);
  });
});

describe("tabShowsInactiveScreen", () => {
  test("gates every tab but Settings while the workspace is inactive", () => {
    for (const tab of [
      "home",
      "assets",
      "scanner",
      "bookings",
      "audits",
      "custody",
    ]) {
      assert.equal(tabShowsInactiveScreen(tab, org("a", true)), true, tab);
    }
    assert.equal(tabShowsInactiveScreen("settings", org("a", true)), false);
  });

  test("gates nothing in an active workspace, or with none open", () => {
    assert.equal(tabShowsInactiveScreen("home", org("a", false)), false);
    assert.equal(tabShowsInactiveScreen("home", org("a")), false);
    assert.equal(tabShowsInactiveScreen("home", null), false);
  });
});

describe("activeTeamWorkspaces", () => {
  test("offers only active team workspaces, in order", () => {
    const personal = { ...org("personal", false), type: "PERSONAL" };
    assert.deepEqual(
      activeTeamWorkspaces([
        personal,
        org("lapsed", true),
        org("team-b", false),
        org("team-c"),
      ]).map((o) => o.id),
      ["team-b", "team-c"]
    );
  });
});

describe("workspaceInactiveScanResult", () => {
  test("titles the card Workspace Inactive with the server's text", () => {
    assert.deepEqual(workspaceInactiveScanResult("Disabled."), {
      title: "Workspace Inactive",
      message: "Disabled.",
      announcement: "Workspace inactive",
    });
    assert.equal(
      workspaceInactiveScanResult(null).message,
      "The workspace this code belongs to is inactive."
    );
  });
});
