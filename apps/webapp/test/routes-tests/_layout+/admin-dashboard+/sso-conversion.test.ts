/**
 * Admin SSO conversion route: admin gating, the loader's view of a domain, the
 * action's hand-off to the conversion engine for each intent, and the
 * per-workspace "Require SSO login" switch.
 *
 * @see {@link file://./../../../../app/routes/_layout+/admin-dashboard+/sso-conversion.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  action,
  loader,
} from "~/routes/_layout+/admin-dashboard+/sso-conversion";
import { ShelfError } from "~/utils/error";

// why: the engine writes to the auth schema, which needs a real Supabase; this
// file tests the route around it.
vi.mock("~/modules/auth/sso-conversion.server", () => ({
  convertAccountToSso: vi.fn(),
  convertAllEligibleOnDomain: vi.fn(),
  findEligibleAccountsForSsoConversion: vi.fn(),
  revertAccountToStandard: vi.fn(),
}));
// why: the switch is written through Prisma; the route test checks which
// workspace it is written for, and when it is refused.
vi.mock("~/modules/organization/service.server", () => ({
  setRequireSsoLogin: vi.fn(),
}));
// why: checkDomainSSOStatus reads auth.sso_domains with raw SQL.
vi.mock("~/utils/sso.server", () => ({
  checkDomainSSOStatus: vi.fn(),
}));
// why: requireAdmin reads the caller's roles from the database.
vi.mock("~/utils/roles.server", () => ({
  requireAdmin: vi.fn(),
}));
// why: notifications go out over the server-sent-events emitter.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the route answers with react-router's data(), which returns a
// DataWithResponseInit rather than a Response; mocking it to a real Response is
// the convention the other route tests use, and lets the status be asserted.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: createDataMock(),
}));

import {
  convertAccountToSso,
  convertAllEligibleOnDomain,
  findEligibleAccountsForSsoConversion,
  revertAccountToStandard,
} from "~/modules/auth/sso-conversion.server";
import { setRequireSsoLogin } from "~/modules/organization/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { requireAdmin } from "~/utils/roles.server";
import { checkDomainSSOStatus } from "~/utils/sso.server";

/** The admin driving the page. */
const ADMIN_ID = "admin-1";

/** Builds loader args for `/admin-dashboard/sso-conversion?<search>`. */
function loaderArgs(search = "") {
  return {
    request: new Request(
      `http://localhost/admin-dashboard/sso-conversion${search}`
    ),
    params: {},
    context: { getSession: () => ({ userId: ADMIN_ID }) },
  } as unknown as Parameters<typeof loader>[0];
}

/**
 * Builds action args posting `fields`.
 *
 * why: a URLSearchParams body, because happy-dom drops empty FormData fields on
 * the Request round-trip.
 */
function actionArgs(fields: Record<string, string>) {
  return {
    request: new Request("http://localhost/admin-dashboard/sso-conversion", {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: { getSession: () => ({ userId: ADMIN_ID }) },
  } as unknown as Parameters<typeof action>[0];
}

/** Reinterprets a result as the `Response` the mocked `data()` returns. */
function asResponse(value: unknown): Response {
  return value as Response;
}

/** The ShelfError `requireAdmin` throws for a caller without the ADMIN role. */
function forbidden() {
  return new ShelfError({
    cause: null,
    message: "You do not have permission to access this resource",
    label: "Permission",
    status: 403,
    shouldBeCaptured: false,
  });
}

/** A linked organization as `checkDomainSSOStatus` returns it. */
function linkedOrg(
  id: string,
  groups: Partial<
    Record<"adminGroupId" | "selfServiceGroupId" | "baseUserGroupId", string>
  > = {},
  requireSsoLogin = true
) {
  return {
    id,
    name: `Workspace ${id}`,
    ssoDetails: {
      id: `sso-${id}`,
      domain: "acme.com",
      adminGroupId: groups.adminGroupId ?? null,
      selfServiceGroupId: groups.selfServiceGroupId ?? null,
      baseUserGroupId: groups.baseUserGroupId ?? null,
      requireSsoLogin,
    },
  };
}

describe("admin sso-conversion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: ADMIN_ID });
  });

  describe("loader", () => {
    it("refuses a non-admin with 403", async () => {
      vi.mocked(requireAdmin).mockRejectedValue(forbidden());

      const thrown = await loader(loaderArgs("?domain=acme.com")).catch(
        (e: unknown) => e
      );

      expect(asResponse(thrown).status).toBe(403);
      expect(findEligibleAccountsForSsoConversion).not.toHaveBeenCalled();
    });

    it("returns an empty view when no domain is given", async () => {
      const result = await loader(loaderArgs());

      expect(result).toEqual(
        expect.objectContaining({
          domain: "",
          isConfiguredForSSO: false,
          candidates: [],
          linkedWorkspaces: [],
        })
      );
      expect(checkDomainSSOStatus).not.toHaveBeenCalled();
      expect(findEligibleAccountsForSsoConversion).not.toHaveBeenCalled();
    });

    it("returns the candidates and each linked workspace's group-mapping and switch state", async () => {
      const candidates = [
        {
          id: "user-1",
          email: "sam@acme.com",
          firstName: "Sam",
          lastName: "Lee",
          displayName: null,
          ownsSsoWorkspace: false,
          alreadySso: false,
          hasEarlierSsoLogin: false,
        },
      ];
      vi.mocked(checkDomainSSOStatus).mockResolvedValue({
        isConfiguredForSSO: true,
        linkedOrganizations: [
          linkedOrg("mapped", { selfServiceGroupId: "grp-1" }),
          linkedOrg("unmapped", {}, false),
        ],
        ssoProviderId: "provider-1",
      } as never);
      vi.mocked(findEligibleAccountsForSsoConversion).mockResolvedValue(
        candidates
      );

      const result = await loader(loaderArgs("?domain=%20@ACME.com%20"));

      expect(checkDomainSSOStatus).toHaveBeenCalledWith("x@acme.com");
      expect(findEligibleAccountsForSsoConversion).toHaveBeenCalledWith(
        "acme.com"
      );
      expect(result).toEqual(
        expect.objectContaining({
          domain: "acme.com",
          isConfiguredForSSO: true,
          candidates,
          linkedWorkspaces: [
            {
              id: "mapped",
              name: "Workspace mapped",
              hasGroupMappings: true,
              requireSsoLogin: true,
            },
            {
              id: "unmapped",
              name: "Workspace unmapped",
              hasGroupMappings: false,
              requireSsoLogin: false,
            },
          ],
        })
      );
    });
  });

  describe("action", () => {
    it("refuses a non-admin with 403 and converts nothing", async () => {
      vi.mocked(requireAdmin).mockRejectedValue(forbidden());

      const response = await action(
        actionArgs({ intent: "convert-one", targetUserId: "user-1" })
      );

      expect(asResponse(response).status).toBe(403);
      expect(convertAccountToSso).not.toHaveBeenCalled();
    });

    it("converts the target user and records the admin as the actor", async () => {
      vi.mocked(convertAccountToSso).mockResolvedValue({
        userId: "user-1",
        email: "sam@acme.com",
        status: "converted",
        needsExtraSignIn: false,
      });

      const result = await action(
        actionArgs({ intent: "convert-one", targetUserId: "user-1" })
      );

      expect(convertAccountToSso).toHaveBeenCalledWith({
        userId: "user-1",
        actorUserId: ADMIN_ID,
      });
      expect(result).toEqual(
        expect.objectContaining({
          result: expect.objectContaining({ status: "converted" }),
        })
      );
      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "sam@acme.com can now sign in via SSO.",
        })
      );
    });

    it("tells the admin about the extra sign-in when the user tried SSO before conversion", async () => {
      vi.mocked(convertAccountToSso).mockResolvedValue({
        userId: "user-1",
        email: "sam@acme.com",
        status: "converted",
        needsExtraSignIn: true,
      });

      await action(
        actionArgs({ intent: "convert-one", targetUserId: "user-1" })
      );

      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/sign in once more/),
        })
      );
    });

    it("answers with the engine's status when the conversion is refused", async () => {
      vi.mocked(convertAccountToSso).mockRejectedValue(
        new ShelfError({
          cause: null,
          message: "This email domain is not configured for SSO.",
          label: "SSO",
          status: 400,
          shouldBeCaptured: false,
        })
      );

      const response = await action(
        actionArgs({ intent: "convert-one", targetUserId: "user-1" })
      );
      const body = (await asResponse(response).json()) as {
        error?: { message?: string };
      };

      expect(asResponse(response).status).toBe(400);
      expect(body.error?.message).toBe(
        "This email domain is not configured for SSO."
      );
    });

    it("refuses a submission without a target user", async () => {
      const response = await action(actionArgs({ intent: "convert-one" }));

      expect(asResponse(response).status).toBe(400);
      expect(convertAccountToSso).not.toHaveBeenCalled();
    });

    it("refuses an unknown or missing intent with 400 and runs nothing", async () => {
      const cases: Record<string, string>[] = [
        { intent: "delete-everyone", targetUserId: "user-1" },
        { targetUserId: "user-1" },
      ];
      for (const fields of cases) {
        const response = await action(actionArgs(fields));
        expect(asResponse(response).status).toBe(400);
      }

      expect(convertAccountToSso).not.toHaveBeenCalled();
      expect(convertAllEligibleOnDomain).not.toHaveBeenCalled();
      expect(revertAccountToStandard).not.toHaveBeenCalled();
    });

    describe("convert-all", () => {
      it("refuses a non-admin with 403 and converts nothing", async () => {
        vi.mocked(requireAdmin).mockRejectedValue(forbidden());

        const response = await action(
          actionArgs({ intent: "convert-all", domain: "acme.com" })
        );

        expect(asResponse(response).status).toBe(403);
        expect(convertAllEligibleOnDomain).not.toHaveBeenCalled();
      });

      it("converts the domain, records the admin as the actor and returns the summary", async () => {
        const summary = {
          converted: 3,
          needsExtraSignIn: 0,
          skippedOwners: 0,
          failed: [
            { userId: "user-9", email: "kim@acme.com", message: "Boom." },
          ],
        };
        vi.mocked(convertAllEligibleOnDomain).mockResolvedValue(summary);

        const result = await action(
          actionArgs({ intent: "convert-all", domain: "acme.com" })
        );

        expect(convertAllEligibleOnDomain).toHaveBeenCalledWith({
          domain: "acme.com",
          actorUserId: ADMIN_ID,
        });
        expect(convertAccountToSso).not.toHaveBeenCalled();
        expect(result).toEqual(
          expect.objectContaining({ intent: "convert-all", result: summary })
        );
      });

      it("mentions the extra sign-ins in the toast when some users tried SSO first", async () => {
        vi.mocked(convertAllEligibleOnDomain).mockResolvedValue({
          converted: 3,
          needsExtraSignIn: 2,
          skippedOwners: 0,
          failed: [],
        });

        await action(actionArgs({ intent: "convert-all", domain: "acme.com" }));

        expect(sendNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            message: expect.stringContaining(
              "2 accounts tried SSO before conversion"
            ),
          })
        );
      });

      it("refuses a submission without a domain", async () => {
        const response = await action(
          actionArgs({ intent: "convert-all", domain: "  " })
        );

        expect(asResponse(response).status).toBe(400);
        expect(convertAllEligibleOnDomain).not.toHaveBeenCalled();
      });
    });

    describe("revert", () => {
      it("refuses a non-admin with 403 and reverts nothing", async () => {
        vi.mocked(requireAdmin).mockRejectedValue(forbidden());

        const response = await action(
          actionArgs({ intent: "revert", targetUserId: "user-1" })
        );

        expect(asResponse(response).status).toBe(403);
        expect(revertAccountToStandard).not.toHaveBeenCalled();
      });

      it("reverts the target user and records the admin as the actor", async () => {
        vi.mocked(revertAccountToStandard).mockResolvedValue({
          userId: "owner-1",
          email: "olu@acme.com",
          status: "reverted",
        });

        const result = await action(
          actionArgs({ intent: "revert", targetUserId: "owner-1" })
        );

        expect(revertAccountToStandard).toHaveBeenCalledWith({
          userId: "owner-1",
          actorUserId: ADMIN_ID,
        });
        expect(result).toEqual(
          expect.objectContaining({
            intent: "revert",
            result: expect.objectContaining({ status: "reverted" }),
          })
        );
      });

      it("answers with the engine's status when the revert is refused", async () => {
        const message =
          "Only an owner of the workspace that uses SSO for this domain, or an account whose domain no longer uses SSO, can be reverted.";
        vi.mocked(revertAccountToStandard).mockRejectedValue(
          new ShelfError({
            cause: null,
            message,
            label: "SSO",
            status: 400,
            shouldBeCaptured: false,
          })
        );

        const response = await action(
          actionArgs({ intent: "revert", targetUserId: "user-1" })
        );
        const body = (await asResponse(response).json()) as {
          error?: { message?: string };
        };

        expect(asResponse(response).status).toBe(400);
        expect(body.error?.message).toBe(message);
      });
    });

    describe("set-require-sso", () => {
      beforeEach(() => {
        vi.mocked(checkDomainSSOStatus).mockResolvedValue({
          isConfiguredForSSO: true,
          linkedOrganizations: [linkedOrg("linked")],
          ssoProviderId: "provider-1",
        } as never);
      });

      it("refuses a non-admin with 403 and writes nothing", async () => {
        vi.mocked(requireAdmin).mockRejectedValue(forbidden());

        const response = await action(
          actionArgs({
            intent: "set-require-sso",
            domain: "acme.com",
            organizationId: "linked",
            requireSsoLogin: "false",
          })
        );

        expect(asResponse(response).status).toBe(403);
        expect(setRequireSsoLogin).not.toHaveBeenCalled();
      });

      it("writes the switch for a workspace linked to the domain", async () => {
        const result = await action(
          actionArgs({
            intent: "set-require-sso",
            domain: " @ACME.com ",
            organizationId: "linked",
            requireSsoLogin: "false",
          })
        );

        expect(checkDomainSSOStatus).toHaveBeenCalledWith("x@acme.com");
        expect(setRequireSsoLogin).toHaveBeenCalledWith({
          organizationId: "linked",
          requireSsoLogin: false,
        });
        expect(result).toEqual(
          expect.objectContaining({
            intent: "set-require-sso",
            organizationId: "linked",
            requireSsoLogin: false,
          })
        );
      });

      it("turns the switch back on", async () => {
        await action(
          actionArgs({
            intent: "set-require-sso",
            domain: "acme.com",
            organizationId: "linked",
            requireSsoLogin: "true",
          })
        );

        expect(setRequireSsoLogin).toHaveBeenCalledWith({
          organizationId: "linked",
          requireSsoLogin: true,
        });
      });

      it("refuses a workspace that is not linked to the domain with 400", async () => {
        const response = await action(
          actionArgs({
            intent: "set-require-sso",
            domain: "acme.com",
            organizationId: "someone-elses",
            requireSsoLogin: "false",
          })
        );

        expect(asResponse(response).status).toBe(400);
        expect(setRequireSsoLogin).not.toHaveBeenCalled();
      });

      it("refuses a value other than true or false with 400", async () => {
        const response = await action(
          actionArgs({
            intent: "set-require-sso",
            domain: "acme.com",
            organizationId: "linked",
            requireSsoLogin: "on",
          })
        );

        expect(asResponse(response).status).toBe(400);
        expect(setRequireSsoLogin).not.toHaveBeenCalled();
      });
    });
  });
});
