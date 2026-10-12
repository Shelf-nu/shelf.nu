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
import { ORGANIZATION_ROLES, ROLE_LABELS } from "./roles";

describe("ROLE_POLICIES", () => {
  test("every role has a policy with a unique rank", () => {
    const ranks = ORGANIZATION_ROLES.map((r) => ROLE_POLICIES[r].rank);
    assert.equal(new Set(ranks).size, ORGANIZATION_ROLES.length);
  });

  test("ranks order the roles OWNER > ADMIN > SELF_SERVICE > BASE", () => {
    assert.deepEqual(ROLES_BY_RANK, ["OWNER", "ADMIN", "SELF_SERVICE", "BASE"]);
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
    assert.deepEqual(INVITABLE_ROLES, ["ADMIN", "SELF_SERVICE", "BASE"]);
    assert.deepEqual(SSO_ASSIGNABLE_ROLES, ["ADMIN", "SELF_SERVICE", "BASE"]);
  });

  test("every role has a label", () => {
    assert.deepEqual(ROLE_LABELS, {
      OWNER: "Owner",
      ADMIN: "Administrator",
      SELF_SERVICE: "Self service",
      BASE: "Base",
    });
  });
});

describe("resolveRole", () => {
  test("picks the most privileged role regardless of order", () => {
    assert.equal(resolveRole(["SELF_SERVICE", "ADMIN"]), "ADMIN");
    assert.equal(resolveRole(["ADMIN", "SELF_SERVICE"]), "ADMIN");
    assert.equal(resolveRole(["BASE", "SELF_SERVICE"]), "SELF_SERVICE");
  });

  test("empty, undefined and unknown roles resolve to BASE, never higher", () => {
    assert.equal(resolveRole([]), "BASE");
    assert.equal(resolveRole(undefined), "BASE");
    assert.equal(resolveRole(["NOT_A_ROLE"]), "BASE");
    assert.equal(resolveRole(["NOT_A_ROLE", "SELF_SERVICE"]), "SELF_SERVICE");
  });
});
