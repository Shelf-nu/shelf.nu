/**
 * Test doubles for the mobile workspace gate in
 * `~/modules/api/mobile-auth.server`: a fake `getMobileWorkspaceAccess` for
 * tests that stub that module, and a sibling membership row for tests that
 * keep the real gate.
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
 * does not. It ignores `reason` and never answers `inactive`: which message a
 * scanned code gets is pinned in mobile-code-resolve.server.test.ts and the
 * barcode route test, which use the real gate or override this spy.
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

/**
 * A membership row as the barcode route selects it for a sibling workspace:
 * the barcode capability plus the workspace gate's columns
 * (`MOBILE_WORKSPACE_GATE_MEMBERSHIP_SELECT`). The workspace is a TEAM
 * workspace the caller belongs to but does not own.
 *
 * @param organizationId - The sibling workspace.
 * @param options.barcodesEnabled - The workspace's barcode add-on (default on).
 * @param options.ownerTierLimitId - The owner's tier limit; `"free"` or
 *   `"tier_1"` is a lapsed Team plan (default `"tier_2"`, active).
 */
export function mobileSiblingMembership(
  organizationId: string,
  {
    barcodesEnabled = true,
    ownerTierLimitId = "tier_2",
  }: {
    barcodesEnabled?: boolean;
    ownerTierLimitId?: "free" | "tier_1" | "tier_2";
  } = {}
) {
  return {
    organizationId,
    organization: {
      barcodesEnabled,
      type: "TEAM" as const,
      userId: `owner-of-${organizationId}`,
      workspaceDisabled: false,
      owner: { tier: { tierLimitId: ownerTierLimitId } },
    },
    user: { roles: [] as { name: string }[] },
  };
}
