/**
 * Tests for the role assignment guard. Pins that the guard itself refuses a
 * role no invite may grant, even for the workspace owner, so an OWNER invite
 * is refused whether or not the caller validated its input first, and that an
 * Administrator may invite another Administrator.
 *
 * @see {@link file://./role-assignment.server.ts}
 */
import { assertCanAssignRoles } from "./role-assignment.server";

// @vitest-environment node

describe("assertCanAssignRoles", () => {
  it("refuses an OWNER invite even when the workspace owner makes it", () => {
    let thrown: unknown;
    try {
      assertCanAssignRoles({
        actorOwnsWorkspace: true,
        roles: ["OWNER"],
        organizationId: "org-1",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ status: 400 });
  });

  it("lets a member who does not own the workspace invite an Administrator", () => {
    expect(() =>
      assertCanAssignRoles({
        actorOwnsWorkspace: false,
        roles: ["ADMIN", "BASE"],
        organizationId: "org-1",
      })
    ).not.toThrow();
  });
});
