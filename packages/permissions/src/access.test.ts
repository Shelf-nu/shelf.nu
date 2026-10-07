/**
 * Tests for resolveRoleAccess and the helpers derived from it.
 *
 * @see ./access.ts
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  canManageBookingItems,
  canPartialCheckInOut,
  canRemoveBookingItems,
  isExplicitScanRequired,
  isWorkspaceOwner,
  resolveRoleAccess,
  rolesWhere,
  transfersBookingsOnRoleChange,
  transfersOwnershipOnRoleChange,
} from "./access";

const OFF = {
  selfServiceCanSeeBookings: false,
  baseUserCanSeeBookings: false,
  selfServiceCanSeeCustody: false,
  baseUserCanSeeCustody: false,
};
const access = (roles: string[], workspace = OFF) =>
  resolveRoleAccess({ roles, workspace });

describe("resolveRoleAccess", () => {
  test("admins see and write everything", () => {
    const a = access(["ADMIN"]);
    assert.deepEqual(
      [
        a.bookings.seeAll,
        a.bookings.writeAll,
        a.custody.seeAll,
        a.audits.seeAll,
      ],
      [true, true, true, true]
    );
    assert.equal(a.custody.assign, "anyone");
  });

  test("a restricted role's toggle widens seeing, never writing", () => {
    const ss = access(["SELF_SERVICE"], {
      ...OFF,
      selfServiceCanSeeBookings: true,
    });
    assert.equal(ss.bookings.seeAll, true);
    assert.equal(ss.bookings.writeAll, false);
    // the BASE toggle does not widen SELF_SERVICE
    const ss2 = access(["SELF_SERVICE"], {
      ...OFF,
      baseUserCanSeeBookings: true,
    });
    assert.equal(ss2.bookings.seeAll, false);
  });

  test("custody assignment scopes", () => {
    assert.equal(access(["SELF_SERVICE"]).custody.assign, "self");
    assert.equal(access(["BASE"]).custody.assign, "none");
  });

  test("an empty membership gets BASE access", () => {
    assert.equal(access([]).role, "BASE");
    assert.equal(access([]).bookings.writeAll, false);
  });

  test("ownsWorkspace reads OWNER anywhere in the membership", () => {
    assert.equal(access(["ADMIN", "OWNER"]).ownsWorkspace, true);
    assert.equal(isWorkspaceOwner(["SELF_SERVICE", "OWNER"]), true);
    assert.equal(isWorkspaceOwner(["ADMIN"]), false);
    assert.equal(isWorkspaceOwner(undefined), false);
  });
});

describe("booking item helpers", () => {
  test("BASE removes only in DRAFT, SELF_SERVICE through RESERVED, ADMIN until closed", () => {
    const can = (roles: string[], s: string) =>
      canRemoveBookingItems({
        access: access(roles),
        bookingStatus: s as never,
      });
    assert.deepEqual(
      ["DRAFT", "RESERVED", "ONGOING", "COMPLETE"].map((s) => can(["BASE"], s)),
      [true, false, false, false]
    );
    assert.deepEqual(
      ["DRAFT", "RESERVED", "ONGOING"].map((s) => can(["SELF_SERVICE"], s)),
      [true, true, false]
    );
    assert.deepEqual(
      ["OVERDUE", "COMPLETE", "ARCHIVED", "CANCELLED"].map((s) =>
        can(["ADMIN"], s)
      ),
      [true, false, false, false]
    );
  });

  test("adding items after DRAFT is admin-only and closed bookings refuse everyone", () => {
    const can = (roles: string[], s: string) =>
      canManageBookingItems({
        access: access(roles),
        bookingStatus: s as never,
      });
    assert.equal(can(["SELF_SERVICE"], "DRAFT"), true);
    assert.equal(can(["SELF_SERVICE"], "RESERVED"), false);
    assert.equal(can(["ADMIN"], "ONGOING"), true);
    assert.equal(can(["ADMIN"], "COMPLETE"), false);
  });

  test("partial scan: SELF_SERVICE custodian on a live booking, not a creator", () => {
    const run = (
      custodianUserId: string,
      status: string,
      direction: "checkout" | "checkin"
    ) =>
      canPartialCheckInOut({
        access: access(["SELF_SERVICE"]),
        booking: { status: status as never, custodianUserId },
        userId: "me",
        direction,
      });
    assert.equal(run("me", "ONGOING", "checkin"), true);
    assert.equal(run("me", "RESERVED", "checkin"), false);
    assert.equal(run("me", "RESERVED", "checkout"), true);
    assert.equal(run("someone-else", "ONGOING", "checkin"), false);
    assert.equal(run("someone-else", "DRAFT", "checkin"), true); // manage-items fallback, as today
  });
});

describe("isExplicitScanRequired", () => {
  const settings = {
    requireExplicitCheckoutForAdmin: true,
    requireExplicitCheckoutForSelfService: false,
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: true,
  };
  test("each role reads its own switch; OWNER and BASE are never required", () => {
    const req = (roles: string[], direction: "checkout" | "checkin") =>
      isExplicitScanRequired({ access: access(roles), settings, direction });
    assert.equal(req(["ADMIN"], "checkout"), true);
    assert.equal(req(["ADMIN"], "checkin"), false);
    assert.equal(req(["SELF_SERVICE"], "checkin"), true);
    assert.equal(req(["OWNER"], "checkout"), false);
    assert.equal(req(["BASE"], "checkin"), false);
  });
});

describe("role change transfers", () => {
  test("ownership moves only when the tier drops; SELF_SERVICE <-> BASE never", () => {
    assert.equal(
      transfersOwnershipOnRoleChange({ from: "ADMIN", to: "SELF_SERVICE" }),
      true
    );
    assert.equal(
      transfersOwnershipOnRoleChange({ from: "SELF_SERVICE", to: "BASE" }),
      false
    );
    assert.equal(
      transfersOwnershipOnRoleChange({ from: "BASE", to: "ADMIN" }),
      false
    );
  });
  test("bookings for others move only when writing all becomes writing own", () => {
    assert.equal(
      transfersBookingsOnRoleChange({ from: "ADMIN", to: "BASE" }),
      true
    );
    assert.equal(
      transfersBookingsOnRoleChange({ from: "SELF_SERVICE", to: "BASE" }),
      false
    );
  });
});

describe("rolesWhere", () => {
  test("returns roles in rank order for a policy predicate", () => {
    assert.deepEqual(
      rolesWhere((p) => p.notifications.orgBookingBroadcasts),
      ["OWNER", "ADMIN", "CUSTODY_MANAGER"]
    );
  });
});

describe("delete drafts only", () => {
  test("SELF_SERVICE and BASE delete only drafts; ADMIN and OWNER any status", () => {
    const only = (roles: string[]) =>
      access(roles).policy.bookings.deleteOnlyDrafts;
    assert.deepEqual(
      [
        only(["OWNER"]),
        only(["ADMIN"]),
        only(["SELF_SERVICE"]),
        only(["BASE"]),
      ],
      [false, false, true, true]
    );
  });
});
