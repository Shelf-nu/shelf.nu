/**
 * Fake for `getMobileWorkspaceAccess` in tests that stub
 * `~/modules/api/mobile-auth.server`.
 *
 * The lapse gate has its own tests (mobile-auth.server.workspace-lapse.test.ts).
 * This fake answers membership from the mocked `userOrganization.findUnique`
 * row, as the gate does for an active workspace, so a test's wrong-workspace
 * branches stay driven by that one row. A test that needs an inactive
 * workspace overrides the spy for that call.
 *
 * Use it inside the `vi.mock` factory, which is hoisted above imports:
 *
 * ```ts
 * getMobileWorkspaceAccess: vi.fn(async (args) =>
 *   (await import("@mocks/mobile-workspace-access")).fakeMobileWorkspaceAccess(args)
 * ),
 * ```
 *
 * @see {@link file://./../../app/modules/api/mobile-auth.server.ts}
 */
import { db } from "~/database/db.server";
import type { MobileWorkspaceAccess } from "~/modules/api/mobile-auth.server";

/**
 * Answers `active` when the mocked membership row exists, `not-member` when it
 * does not.
 *
 * @param args.userId - The caller.
 * @param args.organizationId - The workspace asked about.
 * @returns The access answer the real gate gives for an active workspace.
 */
export async function fakeMobileWorkspaceAccess({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<MobileWorkspaceAccess> {
  const row = await db.userOrganization.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
  return { access: row ? "active" : "not-member" };
}
