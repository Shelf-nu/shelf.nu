/**
 * Client custody visibility: must give the same answer the server gives,
 * including for mixed memberships, where the highest role decides.
 *
 * @see {@link file://./custody-and-bookings-permissions.validator.client.ts}
 */
import { describe, expect, it } from "vitest";
import { userHasCustodyViewPermission } from "./custody-and-bookings-permissions.validator.client";

/** The workspace's two custody visibility toggles. */
const org = (ss: boolean, base: boolean) => ({
  selfServiceCanSeeCustody: ss,
  baseUserCanSeeCustody: base,
});

describe("userHasCustodyViewPermission", () => {
  it("admins and owners always see custody", () => {
    expect(
      userHasCustodyViewPermission({
        roles: ["ADMIN"],
        organization: org(false, false),
      })
    ).toBe(true);
    expect(
      userHasCustodyViewPermission({
        roles: ["OWNER"],
        organization: org(false, false),
      })
    ).toBe(true);
  });

  it("restricted roles follow their own toggle only", () => {
    expect(
      userHasCustodyViewPermission({
        roles: ["SELF_SERVICE"],
        organization: org(true, false),
      })
    ).toBe(true);
    expect(
      userHasCustodyViewPermission({
        roles: ["SELF_SERVICE"],
        organization: org(false, true),
      })
    ).toBe(false);
    expect(
      userHasCustodyViewPermission({
        roles: ["BASE"],
        organization: org(false, true),
      })
    ).toBe(true);
  });

  it("a mixed membership follows its highest role, like the server", () => {
    // [BASE, SELF_SERVICE] resolves to SELF_SERVICE: BASE's toggle does not apply.
    expect(
      userHasCustodyViewPermission({
        roles: ["BASE", "SELF_SERVICE"],
        organization: org(false, true),
      })
    ).toBe(false);
    expect(
      userHasCustodyViewPermission({
        roles: ["SELF_SERVICE", "BASE"],
        organization: org(false, true),
      })
    ).toBe(false);
    expect(
      userHasCustodyViewPermission({
        roles: ["BASE", "SELF_SERVICE"],
        organization: org(true, false),
      })
    ).toBe(true);
    expect(
      userHasCustodyViewPermission({
        roles: ["SELF_SERVICE", "ADMIN"],
        organization: org(false, false),
      })
    ).toBe(true);
  });

  it("an empty or unknown membership sees nothing, whatever the toggles", () => {
    expect(
      userHasCustodyViewPermission({ roles: [], organization: org(true, true) })
    ).toBe(false);
    expect(
      userHasCustodyViewPermission({
        roles: undefined,
        organization: org(true, true),
      })
    ).toBe(false);
    expect(
      userHasCustodyViewPermission({
        roles: ["NOT_A_ROLE"] as never,
        organization: org(true, true),
      })
    ).toBe(false);
  });
});
