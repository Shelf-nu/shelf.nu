/**
 * Workspace edit route — authorization against the workspace being edited.
 *
 * This route is reachable while a DIFFERENT workspace is selected: the workspace
 * list links straight to `/account-details/workspace/:id/edit`. A user's roles
 * differ between workspaces, so the caller here is a SELF_SERVICE member of the
 * workspace they are sitting in — a role holding no `workspace` permission at
 * all — and the owner of the one they are editing. Both the page and the SSO
 * intent must be judged by the second.
 *
 * The permission check and the owner gate run for real; only the membership
 * lookup and the reads and writes around them are stubbed.
 *
 * @see {@link file://./../../../app/routes/_layout+/account-details.workspace.$workspaceId.edit.tsx}
 * @see {@link file://./../../../app/utils/roles.server.ts} requirePermissionInOrganization
 */
import { OrganizationRoles, OrganizationType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";
import { assertIsDataWithResponseInit } from "@helpers/assertions";

import { db } from "~/database/db.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";

import {
  action,
  loader,
} from "~/routes/_layout+/account-details.workspace.$workspaceId.edit";

// @vitest-environment node

// why: the organization, user and workspace-count reads have no database in a
// unit test; the authorization under test runs before any write.
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findUniqueOrThrow: vi.fn(), count: vi.fn() },
    user: { findUniqueOrThrow: vi.fn() },
  },
}));

// why: resolves memberships from the session cookie and the database. The
// memberships it returns are the input these tests vary, so they are supplied
// directly; the permission check that consumes them is real.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
}));

// why: tier limits are read from billing data that has no bearing on who may
// open the page.
vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: vi.fn().mockResolvedValue({ id: "tier_2" }),
}));

// why: the admin list and the organization writes query the database; the
// loader test only needs the page to render, and the action stops before writing.
vi.mock("~/modules/organization/service.server", () => ({
  getOrganizationAdmins: vi.fn().mockResolvedValue([]),
  updateOrganization: vi.fn(),
  updateOrganizationPermissions: vi.fn(),
}));

// why: subscription info for the transfer dialog calls Stripe over the network.
vi.mock("~/utils/stripe.server", () => ({
  getOwnerSubscriptionInfo: vi.fn().mockResolvedValue(null),
  premiumIsEnabled: false,
}));

// why: branding eligibility depends on the tier, which is stubbed above.
vi.mock("~/utils/subscription.server", () => ({
  canHideShelfBranding: () => false,
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** The workspace the URL names — NOT the one the user is currently in. */
const EDITED_WORKSPACE = "workspace-being-edited";
/** The workspace whose cookie is set. */
const SELECTED_WORKSPACE = "workspace-currently-selected";

const context = { getSession: () => ({ userId: "user123" }) } as never;

/**
 * The caller is a SELF_SERVICE member of the workspace they are sitting in, and
 * holds `rolesInEdited` in the workspace the URL names.
 *
 * @param rolesInEdited - Roles in the edited workspace; `null` for no membership
 */
function givenMemberships(rolesInEdited: OrganizationRoles[] | null) {
  vi.mocked(getSelectedOrganization).mockResolvedValue({
    organizationId: SELECTED_WORKSPACE,
    organizations: [],
    currentOrganization: {},
    userOrganizations: [
      {
        organization: { id: SELECTED_WORKSPACE },
        roles: [OrganizationRoles.SELF_SERVICE],
      },
      ...(rolesInEdited
        ? [{ organization: { id: EDITED_WORKSPACE }, roles: rolesInEdited }]
        : []),
    ],
  } as never);
}

/**
 * Reads the refusal out of a `data(error(reason), { status })` action response.
 *
 * @param response - What the action returned
 * @returns The error message and the HTTP status it was sent with
 */
function readRefusal(response: unknown) {
  assertIsDataWithResponseInit(response);
  const { error } = response.data as { error: { message: string } };
  return { message: error.message, status: response.init?.status };
}

describe("workspace edit route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.user.findUniqueOrThrow).mockResolvedValue({
      tierId: "tier_2",
    } as never);
    vi.mocked(db.organization.count).mockResolvedValue(0 as never);
    // SSO is off, so an action that clears both gates stops at the next check.
    // That is what makes "did the gates pass" observable without mocking the
    // whole SSO update.
    vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
      id: EDITED_WORKSPACE,
      name: "Edited workspace",
      type: OrganizationType.TEAM,
      userId: "user123",
      enabledSso: false,
      ssoDetails: null,
    } as never);
  });

  describe("loader", () => {
    it("opens for the owner of the edited workspace while sitting in one where they cannot edit", async () => {
      givenMemberships([OrganizationRoles.OWNER]);

      const result = await loader(
        createLoaderArgs({
          request: new Request("http://localhost/test"),
          params: { workspaceId: EDITED_WORKSPACE },
          context,
        })
      );

      expect(result.organization.id).toBe(EDITED_WORKSPACE);
    });

    it("refuses a caller who is not a member of the edited workspace", async () => {
      givenMemberships(null);

      await expect(
        loader(
          createLoaderArgs({
            request: new Request("http://localhost/test"),
            params: { workspaceId: EDITED_WORKSPACE },
            context,
          })
        )
      ).rejects.toMatchObject({ init: { status: 403 } });
      expect(db.organization.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe("action — sso intent", () => {
    async function runSsoIntent() {
      return readRefusal(
        await action(
          createActionArgs({
            request: new Request("http://localhost/test", {
              method: "POST",
              body: new URLSearchParams({ intent: "sso" }),
            }),
            params: { workspaceId: EDITED_WORKSPACE },
            context,
          })
        )
      );
    }

    it("lets the owner of the edited workspace through, whichever workspace is selected", async () => {
      givenMemberships([OrganizationRoles.OWNER]);

      const refusal = await runSsoIntent();

      // Past both gates: the action now refuses for the workspace's own reason.
      expect(refusal).toEqual({
        message: "SSO is not enabled for this organization.",
        status: 400,
      });
    });

    it("refuses an admin of the edited workspace, because SSO is owner-only", async () => {
      // ADMIN clears `workspace: update`. In production the owner-filtered
      // organization read refuses them first; the SSO gate states the rule
      // again where it applies.
      givenMemberships([OrganizationRoles.ADMIN]);

      const refusal = await runSsoIntent();

      expect(refusal).toEqual({
        message: "You are not allowed to edit SSO settings.",
        status: 403,
      });
    });

    it("refuses a caller who is not a member of the edited workspace", async () => {
      givenMemberships(null);

      const refusal = await runSsoIntent();

      expect(refusal.status).toBe(403);
      expect(db.organization.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });
});
