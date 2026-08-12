/**
 * Behavior tests for the client permission validator after it was migrated
 * onto the shared `@shelf/permissions` resolver.
 *
 * The client validator gates ~47 UI call sites and used to hand-roll its own
 * copy of the matrix walk AND the ADMIN/OWNER short-circuit. These tests pin
 * the properties that migration must preserve:
 * 1. The ADMIN/OWNER allow-all short-circuit (effective behavior that never
 *    lived in the raw matrix).
 * 2. Matrix-driven grants/denies for BASE / SELF_SERVICE.
 * 3. The action-ARRAY any-match semantics, which only this validator has —
 *    they were the reason it could not simply call the shared resolver, and
 *    are now part of it.
 * 4. That the adapter stays a pure delegation — a full sweep asserts it never
 *    disagrees with the shared resolver, so a hand-rolled branch creeping back
 *    in fails here instead of silently re-forking web UI from the server.
 *
 * @see {@link file://../../../../../packages/permissions/src/index.ts}
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

describe("userHasPermission (client)", () => {
  describe("ADMIN / OWNER short-circuit", () => {
    it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
      "grants %s an action absent from every role's matrix entry",
      (role) => {
        // qr:update is in NO role's matrix entry — only the short-circuit
        // grants it. This is the exact case that motivated the extraction.
        expect(
          userHasPermission({
            roles: [role],
            entity: PermissionEntity.qr,
            action: PermissionAction.update,
          })
        ).toBe(true);
      }
    );

    it("grants ADMIN even when the action array contains only denied actions", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.ADMIN],
          entity: PermissionEntity.workspace,
          action: [PermissionAction.delete, PermissionAction.changeRole],
        })
      ).toBe(true);
    });

    it("applies the short-circuit when a privileged role is one of several", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.BASE, OrganizationRoles.ADMIN],
          entity: PermissionEntity.workspace,
          action: PermissionAction.delete,
        })
      ).toBe(true);
    });
  });

  describe("matrix lookup", () => {
    it("denies BASE an asset create", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.BASE],
          entity: PermissionEntity.asset,
          action: PermissionAction.create,
        })
      ).toBe(false);
    });

    it("grants BASE an asset read", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.BASE],
          entity: PermissionEntity.asset,
          action: PermissionAction.read,
        })
      ).toBe(true);
    });

    it("grants SELF_SERVICE a booking checkout", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.SELF_SERVICE],
          entity: PermissionEntity.booking,
          action: PermissionAction.checkout,
        })
      ).toBe(true);
    });

    it("denies SELF_SERVICE a kit update but grants kit custody", () => {
      const base = {
        roles: [OrganizationRoles.SELF_SERVICE],
        entity: PermissionEntity.kit,
      };
      expect(
        userHasPermission({ ...base, action: PermissionAction.update })
      ).toBe(false);
      expect(
        userHasPermission({ ...base, action: PermissionAction.custody })
      ).toBe(true);
    });

    it("denies an entity whose action list is empty for the role", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.BASE],
          entity: PermissionEntity.teamMember,
          action: PermissionAction.read,
        })
      ).toBe(false);
    });
  });

  describe("action arrays (any-match)", () => {
    it("grants when one of several actions is held", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.BASE],
          entity: PermissionEntity.asset,
          // create is denied, read is granted → any-match wins
          action: [PermissionAction.create, PermissionAction.read],
        })
      ).toBe(true);
    });

    it("denies when none of the actions is held", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.BASE],
          entity: PermissionEntity.asset,
          action: [PermissionAction.create, PermissionAction.delete],
        })
      ).toBe(false);
    });

    it("denies an empty action array for a non-privileged role", () => {
      expect(
        userHasPermission({
          roles: [OrganizationRoles.BASE],
          entity: PermissionEntity.asset,
          action: [],
        })
      ).toBe(false);
    });
  });

  describe("absent or unknown roles", () => {
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

    it("denies an unknown role string rather than throwing", () => {
      expect(() =>
        userHasPermission({
          // why: roles arrive from session data, so a stale/renamed role can
          // reach this at runtime even though the type forbids it.
          roles: ["LEGACY_ROLE"] as unknown as OrganizationRoles[],
          entity: PermissionEntity.asset,
          action: PermissionAction.read,
        })
      ).not.toThrow();
      expect(
        userHasPermission({
          roles: ["LEGACY_ROLE"] as unknown as OrganizationRoles[],
          entity: PermissionEntity.asset,
          action: PermissionAction.read,
        })
      ).toBe(false);
    });
  });

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
    expect(roles.length * entities.length * actions.length).toBeGreaterThan(0);
  });
});
