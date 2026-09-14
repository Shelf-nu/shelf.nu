/**
 * Workspace edit action — the SSO intent's owner gate.
 *
 * This route is reachable while a DIFFERENT workspace is selected: the
 * workspace list links straight to `/account-details/workspace/:id/edit`. So
 * the gate has to test the role held in the workspace named by the params, and
 * these tests pin which membership it reads by giving the caller two different
 * roles in two different workspaces.
 *
 * @see {@link file://./../../../app/routes/_layout+/account-details.workspace.$workspaceId.edit.tsx}
 */
import { OrganizationRoles, OrganizationType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/_layout+/account-details.workspace.$workspaceId.edit";

// @vitest-environment node

// why: the gate under test runs before any write, so the two reads the action
// makes on the way there are stubbed rather than exercised.
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findUniqueOrThrow: vi.fn(), count: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
  },
}));

vi.mock("~/utils/roles.server", async (importOriginal) => {
  const actual = await importOriginal<typeof rolesServer>();
  return {
    requirePermission: vi.fn(),
    // why: `isOrganizationOwner` is the subject — stubbing it would test the
    // stub. Only the permission check around it is replaced.
    isOrganizationOwner: actual.isOrganizationOwner,
  };
});

vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: vi.fn().mockResolvedValue({ id: "tier_2" }),
}));

vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationAdmins: vi.fn(),
  updateOrganization: vi.fn(),
  updateOrganizationPermissions: vi.fn(),
}));

vi.mock("~/utils/stripe.server", () => ({
  getOwnerSubscriptionInfo: vi.fn(),
  premiumIsEnabled: false,
}));

vi.mock("~/utils/subscription.server", () => ({
  canHideShelfBranding: () => false,
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** The workspace the URL names — NOT the one the user is currently in. */
const TARGET_WORKSPACE = "workspace-being-edited";
/** The workspace whose cookie is set, i.e. what `requirePermission` resolves. */
const SELECTED_WORKSPACE = "workspace-currently-selected";

describe("workspace edit action — sso intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
      tierId: "tier_2",
    } as never);

    // SSO is off, so a caller who clears the owner gate stops at the next
    // check. That is what makes "did the gate pass" observable without
    // mocking the whole SSO update.
    vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
      id: TARGET_WORKSPACE,
      type: OrganizationType.TEAM,
      enabledSso: false,
      ssoDetails: null,
    } as never);
  });

  /**
   * @param rolesInTarget - Roles held in the workspace named by the params
   */
  async function runSsoIntent(rolesInTarget: OrganizationRoles[]) {
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: SELECTED_WORKSPACE,
      organizations: [],
      // The caller is a plain member of the workspace they are sitting in.
      role: OrganizationRoles.SELF_SERVICE,
      userOrganizations: [
        {
          organization: { id: SELECTED_WORKSPACE },
          roles: [OrganizationRoles.SELF_SERVICE],
        },
        { organization: { id: TARGET_WORKSPACE }, roles: rolesInTarget },
      ],
    } as never);

    const response: any = await action(
      createActionArgs({
        request: new Request("http://localhost/test", {
          method: "POST",
          body: new URLSearchParams({ intent: "sso" }),
        }),
        params: { workspaceId: TARGET_WORKSPACE },
        context: { getSession: () => ({ userId: "user123" }) } as never,
      })
    );

    return response;
  }

  it("lets the owner of the edited workspace through, whichever workspace is selected", async () => {
    const response = await runSsoIntent([OrganizationRoles.OWNER]);

    // Past the gate: the action now refuses for the workspace's own reason.
    expect(response.data.error.message).toBe(
      "SSO is not enabled for this organization."
    );
    expect(response.init.status).toBe(400);
  });

  it("refuses a caller who does not own the edited workspace", async () => {
    // Belt and braces: the organization read above already filters on
    // ownership, so in production a non-owner 403s before reaching here. The
    // gate stays as a second, explicit statement of the rule.
    const response = await runSsoIntent([OrganizationRoles.ADMIN]);

    expect(response.data.error.message).toBe(
      "You are not allowed to edit SSO settings."
    );
    expect(response.init.status).toBe(403);
  });
});
