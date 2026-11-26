/**
 * Tests for the webapp's client-side permission adapter.
 *
 * The RULE itself is tested in the package
 * (`packages/permissions/src/resolver.test.ts`), so those cases are not
 * repeated here. What this module must guarantee is that it only delegates:
 * the UI gates must give exactly the shared resolver's answer for every role,
 * entity and action, so the UI never offers what the server refuses, or the
 * reverse.
 *
 * @see {@link file://../../../../../packages/permissions/src/resolver.test.ts}
 * @see {@link file://./permission.validator.server.test.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import {
  PermissionAction,
  PermissionEntity,
  roleHasPermission,
} from "@shelf/permissions";
import { describe, expect, it } from "vitest";

import { userHasPermission } from "./permission.validator.client";

describe("userHasPermission (client adapter)", () => {
  it("never disagrees with the shared resolver across the whole matrix", () => {
    const roles = Object.values(OrganizationRoles);
    const entities = Object.values(PermissionEntity);
    const actions = Object.values(PermissionAction);

    const disagreements: string[] = [];
    for (const role of roles) {
      for (const entity of entities) {
        for (const action of actions) {
          const viaAdapter = userHasPermission({
            roles: [role],
            entity,
            action,
          });
          const viaResolver = roleHasPermission({
            roles: [role],
            entity,
            action,
          });
          if (viaAdapter !== viaResolver) {
            disagreements.push(`${role}/${entity}/${action}`);
          }
        }
      }
    }

    expect(disagreements).toEqual([]);
    // Guard against the sweep silently covering nothing if an enum is emptied.
    expect(roles.length * entities.length * actions.length).toBe(2640);
  });

  it("forwards action ARRAYS to the resolver rather than reimplementing them", () => {
    // The sweep above only exercises single actions. An action array is
    // granted when any one of its actions is (any-match), and that answer
    // must come from the resolver too.
    const cases: PermissionAction[][] = [
      [PermissionAction.create, PermissionAction.read], // one granted
      [PermissionAction.create, PermissionAction.delete], // none granted
      [], // empty
    ];

    for (const action of cases) {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.BASE],
          entity: PermissionEntity.asset,
          action,
        })
      ).toBe(
        roleHasPermission({
          roles: [OrganizationRoles.BASE],
          entity: PermissionEntity.asset,
          action,
        })
      );
    }
  });

  it.each([
    ["undefined", undefined],
    ["empty", [] as OrganizationRoles[]],
  ])("denies when roles are %s", (_label, roles) => {
    expect(
      userHasPermission({
        roles,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      })
    ).toBe(false);
  });
});
