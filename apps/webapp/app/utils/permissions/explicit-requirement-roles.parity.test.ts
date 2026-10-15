/**
 * Explicit check-in / check-out requirement: the settings copy against the
 * role policy.
 *
 * `@shelf/labels` names the roles the two settings cards offer a switch for
 * (`EXPLICIT_REQUIREMENT_ROLE_LABELS`) and states who the switches never apply
 * to (`EXPLICIT_REQUIREMENT_LABELS.*.EXEMPTION`). Which role a switch actually
 * covers is decided by `bookings.explicitScanSetting` in the role policy table,
 * and the labels package takes no dependency on it. Nothing else connects the
 * two, so a policy change would leave the cards describing a rule the server
 * no longer applies. These cases fail instead.
 *
 * @see {@link file://../../../../../packages/labels/index.js}
 * @see {@link file://../../../../../packages/permissions/src/policies.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import {
  EXPLICIT_REQUIREMENT_LABELS,
  EXPLICIT_REQUIREMENT_ROLE_LABELS,
} from "@shelf/labels";

import {
  PermissionAction,
  PermissionEntity,
  roleHasPermission,
} from "./permission.data";
import { ROLE_POLICIES } from "./role-access";

describe("explicit requirement copy matches the role policy", () => {
  /** The policy setting each labelled switch writes to. */
  const SETTING_OF_SWITCH = {
    ADMIN: "admin",
    SELF_SERVICE: "selfService",
  } as const;

  /** The roles whose policy reads the given switch setting. */
  const rolesReading = (setting: string) =>
    Object.entries(ROLE_POLICIES)
      .filter(([, policy]) => policy.bookings.explicitScanSetting === setting)
      .map(([role]) => role)
      .sort();

  it("offers a switch for exactly the settings the policy reads", () => {
    const readSettings = [
      ...new Set(
        Object.values(ROLE_POLICIES)
          .map((policy) => policy.bookings.explicitScanSetting)
          .filter((setting) => setting !== "none")
      ),
    ].sort();

    expect(readSettings).toEqual(Object.values(SETTING_OF_SWITCH).sort());
    expect(Object.keys(EXPLICIT_REQUIREMENT_ROLE_LABELS).sort()).toEqual(
      Object.keys(SETTING_OF_SWITCH).sort()
    );
  });

  it("names every role a switch covers in that switch's label", () => {
    // The cards bind the "admin" switch to `requireExplicit*ForAdmin` and the
    // "selfService" switch to `requireExplicit*ForSelfService`. A role added to
    // a setting must be named on its switch, or the card under-describes it.
    expect(rolesReading("admin")).toEqual([
      OrganizationRoles.ADMIN,
      OrganizationRoles.MANAGER,
    ]);
    expect(EXPLICIT_REQUIREMENT_ROLE_LABELS.ADMIN).toBe("Admins and Managers");
    expect(rolesReading("selfService")).toEqual([
      OrganizationRoles.SELF_SERVICE,
    ]);
    expect(EXPLICIT_REQUIREMENT_ROLE_LABELS.SELF_SERVICE).toBe(
      "Self Service users"
    );
  });

  it("says the workspace owner is never restricted, which holds while the owner can check in and out", () => {
    const owner = [OrganizationRoles.OWNER];
    expect(
      ROLE_POLICIES[OrganizationRoles.OWNER].bookings.explicitScanSetting
    ).toBe("none");
    for (const action of [
      PermissionAction.checkout,
      PermissionAction.checkin,
    ]) {
      expect(
        roleHasPermission({
          roles: owner,
          entity: PermissionEntity.booking,
          action,
        })
      ).toBe(true);
    }
    expect(EXPLICIT_REQUIREMENT_LABELS.CHECKIN.EXEMPTION).toMatch(
      /workspace owner is never restricted/
    );
  });

  it("says Base users cannot check in or out, which holds while they hold neither permission", () => {
    const base = [OrganizationRoles.BASE];
    for (const action of [
      PermissionAction.checkout,
      PermissionAction.checkin,
    ]) {
      expect(
        roleHasPermission({
          roles: base,
          entity: PermissionEntity.booking,
          action,
        })
      ).toBe(false);
    }
    expect(EXPLICIT_REQUIREMENT_LABELS.CHECKIN.EXEMPTION).toMatch(
      /Base users cannot check in/
    );
    expect(EXPLICIT_REQUIREMENT_LABELS.CHECKOUT.EXEMPTION).toMatch(
      /Base users cannot check out/
    );
  });
});
