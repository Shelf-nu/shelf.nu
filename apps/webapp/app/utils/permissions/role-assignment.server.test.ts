/**
 * Tests for the role assignment guard. Pins that the guard itself refuses a
 * role no invite may grant, even for the workspace owner, so an OWNER invite
 * is refused whether or not the caller validated its input first.
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
});
