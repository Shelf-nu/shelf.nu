/**
 * Tests for the workspace switches `roleHasPermission` unions with the matrix.
 *
 * Every assertion calls the resolver the way both apps do, so these pin the
 * rule a reader of `WORKSPACE_GRANTS` expects: what a switch opens, for whom,
 * and what it never opens.
 *
 * @see ./workspace-grants.ts
 * @see ./resolver.ts
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { roleHasPermission } from "./resolver";
import { ORGANIZATION_ROLES } from "./roles";
import { PermissionAction, PermissionEntity } from "./vocabulary";
import type { WorkspaceGrantSettings } from "./workspace-grants";

const ON: WorkspaceGrantSettings = { managersCanEditAssets: true };
const OFF: WorkspaceGrantSettings = { managersCanEditAssets: false };

const ALL_PAIRS = Object.values(PermissionEntity).flatMap((entity) =>
  Object.values(PermissionAction).map((action) => ({ entity, action }))
);

/** Every entity:action pair whose answer for `roles` differs between OFF and ON. */
function pairsOpenedBySwitch(roles: string[]): string[] {
  return ALL_PAIRS.filter(
    ({ entity, action }) =>
      roleHasPermission({ roles, entity, action, workspace: ON }) !==
      roleHasPermission({ roles, entity, action, workspace: OFF })
  ).map(({ entity, action }) => `${entity}:${action}`);
}

describe("managersCanEditAssets", () => {
  test("opens exactly asset and kit create/update and qr update for a Manager", () => {
    assert.deepEqual(pairsOpenedBySwitch(["MANAGER"]), [
      "asset:create",
      "asset:update",
      "qr:update",
      "kit:create",
      "kit:update",
    ]);
  });

  test("changes nothing for any other role", () => {
    for (const role of ORGANIZATION_ROLES.filter((r) => r !== "MANAGER")) {
      assert.deepEqual(pairsOpenedBySwitch([role]), [], role);
    }
  });

  test("a Manager may create and edit assets and kits only while it is on", () => {
    const can = (
      entity: PermissionEntity,
      action: PermissionAction,
      workspace?: WorkspaceGrantSettings | null
    ) => roleHasPermission({ roles: ["MANAGER"], entity, action, workspace });

    assert.equal(
      can(PermissionEntity.asset, PermissionAction.create, ON),
      true
    );
    assert.equal(can(PermissionEntity.kit, PermissionAction.update, ON), true);
    assert.equal(can(PermissionEntity.qr, PermissionAction.update, ON), true);

    assert.equal(
      can(PermissionEntity.asset, PermissionAction.create, OFF),
      false
    );
    assert.equal(
      can(PermissionEntity.asset, PermissionAction.create, null),
      false
    );
    assert.equal(can(PermissionEntity.asset, PermissionAction.create), false);
  });

  test("never opens delete, archive, import or taxonomy edits for a Manager", () => {
    const denied: Array<[PermissionEntity, PermissionAction]> = [
      [PermissionEntity.asset, PermissionAction.delete],
      [PermissionEntity.asset, PermissionAction.archive],
      [PermissionEntity.asset, PermissionAction.import],
      [PermissionEntity.kit, PermissionAction.delete],
      [PermissionEntity.kit, PermissionAction.archive],
      [PermissionEntity.category, PermissionAction.create],
      [PermissionEntity.category, PermissionAction.update],
      [PermissionEntity.tag, PermissionAction.create],
      [PermissionEntity.location, PermissionAction.create],
      [PermissionEntity.location, PermissionAction.update],
      [PermissionEntity.customField, PermissionAction.create],
      [PermissionEntity.assetModel, PermissionAction.create],
    ];
    for (const [entity, action] of denied) {
      assert.equal(
        roleHasPermission({
          roles: ["MANAGER"],
          entity,
          action,
          workspace: ON,
        }),
        false,
        `${entity}:${action}`
      );
    }
  });

  test("matrixOnly: true answers from the matrix alone", () => {
    assert.equal(
      roleHasPermission({
        roles: ["MANAGER"],
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
        workspace: ON,
        matrixOnly: true,
      }),
      false
    );
    // The opt-out never takes away what the matrix grants.
    assert.equal(
      roleHasPermission({
        roles: ["ADMIN"],
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
        workspace: ON,
        matrixOnly: true,
      }),
      true
    );
  });

  test("applies when Manager is one of several held roles", () => {
    assert.equal(
      roleHasPermission({
        roles: ["BASE", "MANAGER"],
        entity: PermissionEntity.kit,
        action: PermissionAction.create,
        workspace: ON,
      }),
      true
    );
  });

  test("reads a row that never selected the column as off", () => {
    assert.equal(
      roleHasPermission({
        roles: ["MANAGER"],
        entity: PermissionEntity.asset,
        action: PermissionAction.update,
        workspace: {} as WorkspaceGrantSettings,
      }),
      false
    );
  });

  test("matches an action array when the switch grants one of them", () => {
    assert.equal(
      roleHasPermission({
        roles: ["MANAGER"],
        entity: PermissionEntity.asset,
        action: [PermissionAction.delete, PermissionAction.update],
        workspace: ON,
      }),
      true
    );
  });
});
