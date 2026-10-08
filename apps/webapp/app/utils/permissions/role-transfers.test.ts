/**
 * Ownership transfer on a role change: the tier table. SELF_SERVICE and BASE
 * share a tier, so moving between them never transfers ownership.
 *
 * @see {@link file://../../../../../packages/permissions/src/access.ts}
 */
import { describe, expect, it } from "vitest";
import { transfersOwnershipOnRoleChange as moves } from "./role-access";

// @vitest-environment node

describe("transfersOwnershipOnRoleChange", () => {
  it("ADMIN -> BASE and ADMIN -> SELF_SERVICE move ownership", () => {
    expect(moves({ from: "ADMIN", to: "BASE" })).toBe(true);
    expect(moves({ from: "ADMIN", to: "SELF_SERVICE" })).toBe(true);
  });
  it("SELF_SERVICE <-> BASE never moves ownership", () => {
    expect(moves({ from: "SELF_SERVICE", to: "BASE" })).toBe(false);
    expect(moves({ from: "BASE", to: "SELF_SERVICE" })).toBe(false);
  });
  it("promotions never move ownership", () => {
    expect(moves({ from: "BASE", to: "ADMIN" })).toBe(false);
    expect(moves({ from: "SELF_SERVICE", to: "ADMIN" })).toBe(false);
  });
  it("an unchanged role never moves ownership", () => {
    expect(moves({ from: "ADMIN", to: "ADMIN" })).toBe(false);
    expect(moves({ from: "BASE", to: "BASE" })).toBe(false);
  });
  it("OWNER to any lower role moves ownership", () => {
    expect(moves({ from: "OWNER", to: "ADMIN" })).toBe(true);
    expect(moves({ from: "OWNER", to: "BASE" })).toBe(true);
  });
});
