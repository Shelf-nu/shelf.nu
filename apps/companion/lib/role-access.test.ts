/**
 * Tests for the companion's role access: the one place the app resolves how
 * far the signed-in member reaches, from the organization `/api/mobile/me`
 * returns.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * The fixture is the organization shape the producer test pins on the server
 * side; change both together. The mixed-membership and empty-membership cases
 * pin the same answers the webapp's effective-access fixture records for the
 * companion (`B8:*` keys), which reproduces these gates on the webapp side.
 *
 * @see ./role-access.ts
 * @see ../../webapp/test/routes-tests/api+/mobile+/me.test.ts
 * @see ../../webapp/app/utils/permissions/effective-access.probes.ts
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { PermissionAction, PermissionEntity } from "@shelf/permissions";

import type { Organization } from "./api/types";
import { userHasPermission } from "./permissions";
import {
  accessForOrganization,
  canAddItemsToBooking,
  canRemoveItemsFromBooking,
} from "./role-access";

/** One organization from `/api/mobile/me`, as it arrives over the wire. */
function meOrganization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    name: "Workspace",
    type: "TEAM",
    roles: ["SELF_SERVICE"],
    barcodesEnabled: true,
    auditsEnabled: true,
    selfServiceCanSeeBookings: false,
    baseUserCanSeeBookings: false,
    selfServiceCanSeeCustody: false,
    baseUserCanSeeCustody: false,
    ...overrides,
  };
}

/** Access for a membership holding `roles`, every toggle off. */
function accessOf(roles: string[]) {
  return accessForOrganization(meOrganization({ roles }));
}

describe("accessForOrganization", () => {
  test("a see-toggle widens seeing for its own role, never writing", () => {
    const access = accessForOrganization(
      meOrganization({ selfServiceCanSeeBookings: true })
    );
    assert.equal(access.bookings.seeAll, true);
    assert.equal(access.bookings.writeAll, false);
    assert.equal(access.custody.assign, "self");
  });

  test("a server without the toggles (older deploy) reads them as off", () => {
    const { selfServiceCanSeeBookings: _omit, ...legacy } = meOrganization({
      roles: ["SELF_SERVICE"],
    });
    const access = accessForOrganization(legacy);
    assert.equal(access.bookings.seeAll, false);
  });

  test("a mixed [SELF_SERVICE, ADMIN] membership is an admin", () => {
    const access = accessOf(["SELF_SERVICE", "ADMIN"]);
    assert.equal(access.role, "ADMIN");
    assert.equal(access.custody.assign, "anyone");
    assert.equal(access.audits.seeAll, true);
    assert.equal(access.bookings.writeAll, true);
  });

  test("only OWNER and ADMIN see every audit", () => {
    const seeAll = (roles: string[]) => accessOf(roles).audits.seeAll;
    assert.deepEqual(
      [["OWNER"], ["ADMIN"], ["SELF_SERVICE"], ["BASE"]].map(seeAll),
      [true, true, false, false]
    );
  });

  test("a role this build does not know denies every gate (old build + new role)", () => {
    const org = meOrganization({ roles: ["CUSTODY_MANAGER"] });
    const access = accessForOrganization(org);
    assert.equal(access.role, "BASE");
    assert.equal(access.custody.assign, "none");
    assert.equal(access.audits.seeAll, false);
    assert.equal(access.bookings.writeAll, false);
    for (const entity of Object.values(PermissionEntity)) {
      for (const action of Object.values(PermissionAction)) {
        assert.equal(
          userHasPermission({ roles: org.roles, entity, action }),
          false,
          `${entity}:${action}`
        );
      }
    }
  });

  test("no organization yet resolves to BASE", () => {
    assert.equal(accessForOrganization(null).role, "BASE");
  });
});

describe("own-booking writes", () => {
  test("a membership that holds OWNER or ADMIN writes every booking", () => {
    for (const roles of [
      ["OWNER"],
      ["ADMIN"],
      ["SELF_SERVICE", "ADMIN"],
      ["BASE", "OWNER"],
    ]) {
      assert.equal(accessOf(roles).bookings.writeAll, true, roles.join("+"));
    }
  });

  test("an empty membership writes only its own bookings", () => {
    assert.equal(accessOf([]).bookings.writeAll, false);
    assert.equal(accessOf(["SELF_SERVICE"]).bookings.writeAll, false);
    assert.equal(accessOf(["BASE"]).bookings.writeAll, false);
  });
});

describe("custody for yourself only", () => {
  test("SELF_SERVICE alone takes custody only for itself", () => {
    assert.equal(accessOf(["SELF_SERVICE"]).custody.assign, "self");
  });

  test("SELF_SERVICE alongside OWNER or ADMIN assigns to anyone", () => {
    for (const roles of [
      ["OWNER", "SELF_SERVICE"],
      ["ADMIN", "SELF_SERVICE"],
      ["SELF_SERVICE", "OWNER"],
      ["SELF_SERVICE", "ADMIN"],
    ]) {
      assert.equal(accessOf(roles).custody.assign, "anyone", roles.join("+"));
    }
  });
});

describe("booking item rules", () => {
  test("SELF_SERVICE removes items on RESERVED, like the server", () => {
    assert.equal(
      canRemoveItemsFromBooking(accessOf(["SELF_SERVICE"]), "RESERVED"),
      true
    );
    assert.equal(
      canRemoveItemsFromBooking(accessOf(["SELF_SERVICE"]), "ONGOING"),
      false
    );
  });

  test("BASE removes only on DRAFT; ADMIN until the booking closes", () => {
    assert.equal(
      canRemoveItemsFromBooking(accessOf(["BASE"]), "RESERVED"),
      false
    );
    assert.equal(
      canRemoveItemsFromBooking(accessOf(["ADMIN"]), "OVERDUE"),
      true
    );
    assert.equal(
      canRemoveItemsFromBooking(accessOf(["ADMIN"]), "COMPLETE"),
      false
    );
  });

  test("adding after DRAFT is admin-only; closed bookings refuse everyone", () => {
    assert.equal(
      canAddItemsToBooking(accessOf(["SELF_SERVICE"]), "DRAFT"),
      true
    );
    assert.equal(
      canAddItemsToBooking(accessOf(["SELF_SERVICE"]), "RESERVED"),
      false
    );
    assert.equal(canAddItemsToBooking(accessOf(["ADMIN"]), "RESERVED"), true);
    assert.equal(canAddItemsToBooking(accessOf(["ADMIN"]), "ARCHIVED"), false);
  });

  test("a restricted role alongside OWNER or ADMIN manages items past DRAFT", () => {
    for (const roles of [
      ["SELF_SERVICE", "ADMIN"],
      ["BASE", "OWNER"],
    ]) {
      for (const status of ["RESERVED", "ONGOING", "OVERDUE"]) {
        const access = accessOf(roles);
        const label = `${roles.join("+")} ${status}`;
        assert.equal(canAddItemsToBooking(access, status), true, label);
        assert.equal(canRemoveItemsFromBooking(access, status), true, label);
      }
    }
  });

  test("an empty membership manages items on DRAFT only", () => {
    const access = accessOf([]);
    assert.equal(canAddItemsToBooking(access, "DRAFT"), true);
    assert.equal(canRemoveItemsFromBooking(access, "DRAFT"), true);
    for (const status of ["RESERVED", "ONGOING", "OVERDUE"]) {
      assert.equal(canAddItemsToBooking(access, status), false, status);
      assert.equal(canRemoveItemsFromBooking(access, status), false, status);
    }
  });

  test("a status this build does not know denies", () => {
    assert.equal(canAddItemsToBooking(accessOf(["ADMIN"]), "PAUSED"), false);
    assert.equal(
      canRemoveItemsFromBooking(accessOf(["ADMIN"]), "PAUSED"),
      false
    );
  });
});
