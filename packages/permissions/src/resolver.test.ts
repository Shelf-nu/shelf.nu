/**
 * Tests for the pure permission resolver — the one function every
 * authorization decision in both apps resolves through.
 *
 * These live in the package rather than in either app because they describe
 * the RULE, not an app's plumbing. The app-side suites cover what is genuinely
 * theirs: the server's `UserOrganization` lookup and `ShelfError` semantics,
 * and the client adapter's delegation.
 *
 * @see ./resolver.ts
 * @see ../../../apps/webapp/app/utils/permissions/permission.validator.server.test.ts
 * @see ../../../apps/webapp/app/utils/permissions/permission.validator.client.test.ts
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Role2PermissionMap } from "./matrix";
import { roleHasPermission } from "./resolver";
import { PermissionAction, PermissionEntity } from "./vocabulary";

describe("roleHasPermission — ADMIN/OWNER short-circuit", () => {
  test("grants an action that appears in NO role's matrix entry", () => {
    // qr:update is the case that motivated extracting this rule: it is absent
    // from every entry, so only the short-circuit grants it. Assert the
    // premise too, so this stops being a tautology if the matrix changes.
    assert.equal(
      Role2PermissionMap.ADMIN?.[PermissionEntity.qr].includes(
        PermissionAction.update
      ),
      false
    );
    for (const role of ["ADMIN", "OWNER"]) {
      assert.equal(
        roleHasPermission({
          roles: [role],
          entity: PermissionEntity.qr,
          action: PermissionAction.update,
        }),
        true
      );
    }
  });

  test("applies when a privileged role is one of several held", () => {
    assert.equal(
      roleHasPermission({
        roles: ["BASE", "ADMIN"],
        entity: PermissionEntity.workspace,
        action: PermissionAction.delete,
      }),
      true
    );
  });

  test("beats an action array in which nothing is granted", () => {
    assert.equal(
      roleHasPermission({
        roles: ["OWNER"],
        entity: PermissionEntity.workspace,
        action: [PermissionAction.delete, PermissionAction.changeRole],
      }),
      true
    );
  });

  test("deliberately beats an unknown entity, matching pre-extraction behavior", () => {
    // why: main's `hasPermission` returned true for ADMIN/OWNER before ever
    // looking at the entity, so this is behavior-preserving, not an oversight.
    // It confers no privilege these roles do not already hold on every known
    // entity. Pinned so a future reader does not "harden" it into a change.
    assert.equal(
      roleHasPermission({
        roles: ["ADMIN"],
        entity: "not-a-real-entity" as PermissionEntity,
        action: PermissionAction.read,
      }),
      true
    );
  });
});

describe("roleHasPermission — matrix lookup", () => {
  test("denies BASE an asset create and grants an asset read", () => {
    assert.equal(
      roleHasPermission({
        roles: ["BASE"],
        entity: PermissionEntity.asset,
        action: PermissionAction.create,
      }),
      false
    );
    assert.equal(
      roleHasPermission({
        roles: ["BASE"],
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      }),
      true
    );
  });

  test("grants SELF_SERVICE a booking checkout", () => {
    assert.equal(
      roleHasPermission({
        roles: ["SELF_SERVICE"],
        entity: PermissionEntity.booking,
        action: PermissionAction.checkout,
      }),
      true
    );
  });

  test("denies SELF_SERVICE a kit update but grants kit custody", () => {
    assert.equal(
      roleHasPermission({
        roles: ["SELF_SERVICE"],
        entity: PermissionEntity.kit,
        action: PermissionAction.update,
      }),
      false
    );
    assert.equal(
      roleHasPermission({
        roles: ["SELF_SERVICE"],
        entity: PermissionEntity.kit,
        action: PermissionAction.custody,
      }),
      true
    );
  });

  test("denies an entity whose action list is empty for the role", () => {
    assert.equal(
      roleHasPermission({
        roles: ["BASE"],
        entity: PermissionEntity.teamMember,
        action: PermissionAction.read,
      }),
      false
    );
  });

  test("safe-denies an unknown entity for a non-privileged role", () => {
    // This is the one deliberate improvement over main, which dereferenced
    // `undefined.includes(...)` here and surfaced a wrapped 500.
    assert.equal(
      roleHasPermission({
        roles: ["BASE"],
        entity: "not-a-real-entity" as PermissionEntity,
        action: PermissionAction.read,
      }),
      false
    );
  });
});

describe("roleHasPermission — action arrays (any-match)", () => {
  test("grants when one of several actions is held", () => {
    assert.equal(
      roleHasPermission({
        roles: ["BASE"],
        entity: PermissionEntity.asset,
        // create denied, read granted
        action: [PermissionAction.create, PermissionAction.read],
      }),
      true
    );
  });

  test("denies when none of the actions is held", () => {
    assert.equal(
      roleHasPermission({
        roles: ["BASE"],
        entity: PermissionEntity.asset,
        action: [PermissionAction.create, PermissionAction.delete],
      }),
      false
    );
  });

  test("denies an empty action array for a non-privileged role", () => {
    assert.equal(
      roleHasPermission({
        roles: ["BASE"],
        entity: PermissionEntity.asset,
        action: [],
      }),
      false
    );
  });
});

describe("roleHasPermission — absent or unknown roles", () => {
  test("denies undefined and empty role lists", () => {
    for (const roles of [undefined, []]) {
      assert.equal(
        roleHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.read,
        }),
        false
      );
    }
  });

  test("denies an unknown role string rather than throwing", () => {
    // why: roles arrive from session/API data, so a stale or renamed role can
    // reach this at runtime even though the type forbids it.
    assert.doesNotThrow(() =>
      roleHasPermission({
        roles: ["LEGACY_ROLE"],
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      })
    );
    assert.equal(
      roleHasPermission({
        roles: ["LEGACY_ROLE"],
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      }),
      false
    );
  });
});

describe("roleHasPermission — reports entity", () => {
  test("denies BASE and SELF_SERVICE both read and export", () => {
    // Reports aggregate org-wide custody, booking and value data. The
    // sidebar never offers them below ADMIN, and the server matrix must
    // agree — an empty action list, not a missing entry.
    for (const role of ["BASE", "SELF_SERVICE"]) {
      assert.deepEqual(
        Role2PermissionMap[role]?.[PermissionEntity.reports],
        []
      );
      for (const action of [PermissionAction.read, PermissionAction.export]) {
        assert.equal(
          roleHasPermission({
            roles: [role],
            entity: PermissionEntity.reports,
            action,
          }),
          false
        );
      }
    }
  });

  test("grants ADMIN and OWNER read and export", () => {
    for (const role of ["ADMIN", "OWNER"]) {
      for (const action of [PermissionAction.read, PermissionAction.export]) {
        assert.equal(
          roleHasPermission({
            roles: [role],
            entity: PermissionEntity.reports,
            action,
          }),
          true
        );
      }
    }
  });
});
