/**
 * Tests for the companion's matrix check with the workspace permission
 * switches: the phone's create, edit, update-location and QR entry points
 * follow `managersCanEditAssets` from `/api/mobile/me`, exactly as the server
 * does.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./permissions.ts
 * @see ../../../packages/permissions/src/workspace-grants.ts
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Organization } from "./api/types";
import { userHasPermission } from "./permissions";

type Check = Parameters<typeof userHasPermission>[0];

/** A Manager's answer for one entity:action in a workspace with the switch set. */
function managerCan(
  entity: Check["entity"],
  action: Check["action"],
  workspace: Pick<Organization, "managersCanEditAssets"> | null
): boolean {
  return userHasPermission({
    roles: ["MANAGER"],
    workspace,
    entity,
    action,
  });
}

const ON = { managersCanEditAssets: true };
const OFF = { managersCanEditAssets: false };

describe("userHasPermission with managersCanEditAssets", () => {
  test("opens the phone's create, edit, location and QR entry points for a Manager", () => {
    const entryPoints: Array<[Check["entity"], Check["action"]]> = [
      ["asset", "create"],
      ["asset", "update"],
      ["kit", "update"],
      ["qr", "update"],
    ];
    for (const [entity, action] of entryPoints) {
      assert.equal(managerCan(entity, action, ON), true, `${entity}:${action}`);
      assert.equal(
        managerCan(entity, action, OFF),
        false,
        `${entity}:${action}`
      );
    }
  });

  test("reads a workspace from an older server, without the field, as off", () => {
    assert.equal(managerCan("asset", "create", {}), false);
    assert.equal(managerCan("asset", "create", null), false);
  });

  test("never opens delete, archive or tag and category creation", () => {
    for (const [entity, action] of [
      ["asset", "delete"],
      ["asset", "archive"],
      ["tag", "create"],
      ["category", "create"],
      ["location", "create"],
    ] as const) {
      assert.equal(
        managerCan(entity, action, ON),
        false,
        `${entity}:${action}`
      );
    }
  });

  test("leaves every other role's answer unchanged", () => {
    assert.equal(
      userHasPermission({
        roles: ["SELF_SERVICE"],
        workspace: ON,
        entity: "asset",
        action: "create",
      }),
      false
    );
    assert.equal(
      userHasPermission({
        roles: ["ADMIN"],
        workspace: OFF,
        entity: "asset",
        action: "create",
      }),
      true
    );
  });

  test("workspaceGrants: false answers from the matrix alone", () => {
    assert.equal(
      userHasPermission({
        roles: ["MANAGER"],
        workspace: ON,
        entity: "asset",
        action: "update",
        workspaceGrants: false,
      }),
      false
    );
  });
});
