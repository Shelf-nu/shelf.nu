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
  it("offers a switch for exactly the roles the policy lets a switch cover", () => {
    const covered = Object.entries(ROLE_POLICIES)
      .filter(([, policy]) => policy.bookings.explicitScanSetting !== "none")
      .map(([role]) => role)
      .sort();

    expect(covered).toEqual(
      Object.keys(EXPLICIT_REQUIREMENT_ROLE_LABELS).sort()
    );
  });

  it("wires each labelled switch to the setting its role reads", () => {
    // The cards bind the "Admins" switch to `requireExplicit*ForAdmin` and the
    // "Self Service users" switch to `requireExplicit*ForSelfService`.
    expect(
      ROLE_POLICIES[OrganizationRoles.ADMIN].bookings.explicitScanSetting
    ).toBe("admin");
    expect(
      ROLE_POLICIES[OrganizationRoles.SELF_SERVICE].bookings.explicitScanSetting
    ).toBe("selfService");
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
