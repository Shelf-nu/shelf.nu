// @vitest-environment node
/**
 * Shape and floor tests for the static role-permission matrix. The
 * Record<PermissionEntity, ...> type forces row PRESENCE per entity, but an
 * empty array compiles fine — these tests pin the rows whose emptiness would
 * break a role at runtime (403s on surfaces every role must reach).
 */
import { OrganizationRoles } from "@prisma/client";
import {
  PermissionAction,
  PermissionEntity,
  Role2PermissionMap,
} from "./permission.data";

const MAPPED_ROLES = [
  OrganizationRoles.BASE,
  OrganizationRoles.SELF_SERVICE,
  OrganizationRoles.BOOKING_MANAGER,
  OrganizationRoles.ADMIN,
  OrganizationRoles.OWNER,
] as const;

describe("Role2PermissionMap shape", () => {
  it("has a row for every entity in every mapped role", () => {
    for (const role of MAPPED_ROLES) {
      const entityMap = Role2PermissionMap[role];
      expect(entityMap, `missing role ${role}`).toBeDefined();
      for (const entity of Object.values(PermissionEntity)) {
        expect(
          entityMap![entity as PermissionEntity],
          `role ${role} missing entity ${entity}`
        ).toBeDefined();
      }
    }
  });

  it("gives every role the self-serve floor (own account, updates, palette)", () => {
    for (const role of MAPPED_ROLES) {
      const entityMap = Role2PermissionMap[role]!;
      expect(entityMap[PermissionEntity.userData]).toEqual(
        expect.arrayContaining([PermissionAction.read, PermissionAction.update])
      );
      expect(entityMap[PermissionEntity.update]).toContain(
        PermissionAction.read
      );
      expect(entityMap[PermissionEntity.commandPaletteSearch]).toContain(
        PermissionAction.read
      );
      // The booking form's working-hours validation reads this for every
      // role that can create bookings.
      expect(entityMap[PermissionEntity.workingHours]).toContain(
        PermissionAction.read
      );
    }
  });
});

describe("BOOKING_MANAGER matrix (issue #1800)", () => {
  const bm = Role2PermissionMap[OrganizationRoles.BOOKING_MANAGER]!;

  it("holds full booking processing incl. checkout/checkin", () => {
    expect(bm[PermissionEntity.booking]).toEqual(
      expect.arrayContaining([
        PermissionAction.create,
        PermissionAction.read,
        PermissionAction.update,
        PermissionAction.checkout,
        PermissionAction.checkin,
        PermissionAction.cancel,
        PermissionAction.export,
      ])
    );
    // Deliberately NOT granted (absent from #1800's matrix):
    expect(bm[PermissionEntity.booking]).not.toContain(PermissionAction.extend);
    expect(bm[PermissionEntity.booking]).not.toContain(
      PermissionAction.manageKits
    );
  });

  it("reads + takes custody of assets and kits, nothing more", () => {
    expect(bm[PermissionEntity.asset]).toEqual([
      PermissionAction.read,
      PermissionAction.custody,
    ]);
    expect(bm[PermissionEntity.kit]).toEqual([
      PermissionAction.read,
      PermissionAction.custody,
    ]);
  });

  it("administers nothing", () => {
    for (const entity of [
      PermissionEntity.workspace,
      PermissionEntity.dashboard,
      PermissionEntity.generalSettings,
      PermissionEntity.subscription,
      PermissionEntity.emailSettings,
      PermissionEntity.assetReminders,
      PermissionEntity.teamMemberNote,
    ]) {
      expect(bm[entity], `expected ${entity} to be empty`).toEqual([]);
    }
  });

  it("does not rank below BASE on audits (view-everything floor)", () => {
    const base = Role2PermissionMap[OrganizationRoles.BASE]!;
    for (const action of base[PermissionEntity.audit]) {
      expect(bm[PermissionEntity.audit]).toContain(action);
    }
  });

  it("reads reference data that BASE/SELF_SERVICE cannot (per #1800)", () => {
    for (const entity of [
      PermissionEntity.category,
      PermissionEntity.tag,
      PermissionEntity.location,
      PermissionEntity.teamMember,
      PermissionEntity.custody,
    ]) {
      expect(bm[entity]).toContain(PermissionAction.read);
    }
  });
});
