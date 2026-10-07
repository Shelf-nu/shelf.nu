/**
 * Tests for the role policy table and the role resolver.
 *
 * @see ./policies.ts
 * @see ./resolve-role.ts
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { RolePolicy } from "./policies";
import {
  INVITABLE_ROLES,
  ROLE_POLICIES,
  ROLES_BY_RANK,
  SSO_ASSIGNABLE_ROLES,
} from "./policies";
import { resolveRole } from "./resolve-role";
import { roleHasPermission } from "./resolver";
import { ORGANIZATION_ROLES, ROLE_LABELS } from "./roles";

describe("ROLE_POLICIES", () => {
  test("every role has a policy with a unique rank", () => {
    const ranks = ORGANIZATION_ROLES.map((r) => ROLE_POLICIES[r].rank);
    assert.equal(new Set(ranks).size, ORGANIZATION_ROLES.length);
  });

  test("ranks order the roles OWNER > ADMIN > CUSTODY_MANAGER > SELF_SERVICE > BASE", () => {
    assert.deepEqual(ROLES_BY_RANK, [
      "OWNER",
      "ADMIN",
      "CUSTODY_MANAGER",
      "SELF_SERVICE",
      "BASE",
    ]);
  });

  test("an own-scope names the workspace toggle that widens it", () => {
    for (const role of ORGANIZATION_ROLES) {
      const p = ROLE_POLICIES[role];
      const needsToggle =
        p.bookings.see === "own-unless-workspace-allows" ||
        p.custody.see === "own-unless-workspace-allows";
      assert.equal(needsToggle, p.workspaceOverride !== null, role);
    }
  });

  test("an own-scope without a workspace toggle does not compile", () => {
    const admin = ROLE_POLICIES.ADMIN;
    // @ts-expect-error: bookings "own-unless-workspace-allows" requires a workspaceOverride
    const badBookings: RolePolicy = {
      ...admin,
      workspaceOverride: null,
      bookings: { ...admin.bookings, see: "own-unless-workspace-allows" },
    };
    // @ts-expect-error: custody "own-unless-workspace-allows" requires a workspaceOverride
    const badCustody: RolePolicy = {
      ...admin,
      workspaceOverride: null,
      custody: { ...admin.custody, see: "own-unless-workspace-allows" },
    };
    // A named toggle with an own-scope is fine.
    const ok: RolePolicy = ROLE_POLICIES.SELF_SERVICE;
    assert.ok(badBookings && badCustody && ok);
  });

  test("derived role lists come from policy fields, in rank order", () => {
    assert.deepEqual(INVITABLE_ROLES, [
      "ADMIN",
      "CUSTODY_MANAGER",
      "SELF_SERVICE",
      "BASE",
    ]);
    assert.deepEqual(SSO_ASSIGNABLE_ROLES, [
      "ADMIN",
      "CUSTODY_MANAGER",
      "SELF_SERVICE",
      "BASE",
    ]);
  });

  test("every role has a label", () => {
    assert.deepEqual(ROLE_LABELS, {
      OWNER: "Owner",
      ADMIN: "Administrator",
      CUSTODY_MANAGER: "Custody manager",
      SELF_SERVICE: "Self service",
      BASE: "Base",
    });
  });

  test("the Custody Manager reaches every booking and custody, like an Administrator", () => {
    const cm = ROLE_POLICIES.CUSTODY_MANAGER;
    const admin = ROLE_POLICIES.ADMIN;
    assert.deepEqual(cm.bookings, admin.bookings);
    assert.deepEqual(cm.custody, admin.custody);
    assert.deepEqual(cm.assets, admin.assets);
    assert.equal(cm.workspaceOverride, null);
  });

  test("the Custody Manager differs from an Administrator only where the spec says", () => {
    const cm = ROLE_POLICIES.CUSTODY_MANAGER;
    assert.equal(cm.rank, 3);
    assert.deepEqual(cm.audits, { scope: "assigned", manageOthers: false });
    assert.deepEqual(cm.notifications, {
      orgBookingBroadcasts: true,
      reservationAlertsAdmins: false,
      manageBookingRecipients: true,
      inventoryAlerts: false,
      selectableAsRecipient: true,
    });
    assert.deepEqual(cm.ui, {
      landing: "/bookings",
      defaultAssetIndexMode: "ADVANCED",
      advancedAssetIndex: true,
    });
    assert.deepEqual(cm.membership, {
      ownershipTier: 2,
      changeRequiresOwner: false,
      canReceiveTransfers: false,
      eligibleAsNewOwner: false,
      invitable: true,
      ssoAssignable: true,
      ownsWorkspace: false,
    });
  });

  // A member's Bookings tab lists every booking of the member being viewed
  // with no visibility filter, so opening profiles must imply seeing every
  // booking. A role that breaks this would leak bookings through that tab.
  test("every role that can open another member's profile sees every booking", () => {
    for (const role of ORGANIZATION_ROLES) {
      const opensProfiles = roleHasPermission({
        roles: [role],
        entity: "teamMemberProfile",
        action: "read",
      });
      if (opensProfiles) {
        assert.equal(ROLE_POLICIES[role].bookings.see, "all", role);
      }
    }
  });
});

describe("resolveRole", () => {
  test("picks the most privileged role regardless of order", () => {
    assert.equal(resolveRole(["SELF_SERVICE", "ADMIN"]), "ADMIN");
    assert.equal(resolveRole(["ADMIN", "SELF_SERVICE"]), "ADMIN");
    assert.equal(resolveRole(["BASE", "SELF_SERVICE"]), "SELF_SERVICE");
  });

  test("ranks the Custody Manager between Administrator and Self service", () => {
    assert.equal(
      resolveRole(["SELF_SERVICE", "CUSTODY_MANAGER"]),
      "CUSTODY_MANAGER"
    );
    assert.equal(
      resolveRole(["CUSTODY_MANAGER", "SELF_SERVICE"]),
      "CUSTODY_MANAGER"
    );
    assert.equal(resolveRole(["CUSTODY_MANAGER", "ADMIN"]), "ADMIN");
  });

  test("empty, undefined and unknown roles resolve to BASE, never higher", () => {
    assert.equal(resolveRole([]), "BASE");
    assert.equal(resolveRole(undefined), "BASE");
    assert.equal(resolveRole(["NOT_A_ROLE"]), "BASE");
    assert.equal(resolveRole(["NOT_A_ROLE", "SELF_SERVICE"]), "SELF_SERVICE");
  });
});
