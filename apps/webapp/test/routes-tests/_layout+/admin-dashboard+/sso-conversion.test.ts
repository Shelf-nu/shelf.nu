/**
 * Admin SSO conversion route: admin gating, the loader's view of a domain, and
 * the action's hand-off to the conversion engine.
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
  findEligibleAccountsForSsoConversion: vi.fn(),
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
  findEligibleAccountsForSsoConversion,
} from "~/modules/auth/sso-conversion.server";
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
  > = {}
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

    it("returns the candidates and each linked workspace's group-mapping state", async () => {
      const candidates = [
        {
          id: "user-1",
          email: "sam@acme.com",
          firstName: "Sam",
          lastName: "Lee",
          displayName: null,
          ownsTeamOrg: false,
          alreadySso: false,
        },
      ];
      vi.mocked(checkDomainSSOStatus).mockResolvedValue({
        isConfiguredForSSO: true,
        linkedOrganizations: [
          linkedOrg("mapped", { selfServiceGroupId: "grp-1" }),
          linkedOrg("unmapped"),
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
            { id: "mapped", name: "Workspace mapped", hasGroupMappings: true },
            {
              id: "unmapped",
              name: "Workspace unmapped",
              hasGroupMappings: false,
            },
          ],
        })
      );
    });
  });

  describe("action", () => {
    it("refuses a non-admin with 403 and converts nothing", async () => {
      vi.mocked(requireAdmin).mockRejectedValue(forbidden());

      const response = await action(actionArgs({ targetUserId: "user-1" }));

      expect(asResponse(response).status).toBe(403);
      expect(convertAccountToSso).not.toHaveBeenCalled();
    });

    it("converts the target user and records the admin as the actor", async () => {
      vi.mocked(convertAccountToSso).mockResolvedValue({
        userId: "user-1",
        email: "sam@acme.com",
        status: "converted",
      });

      const result = await action(actionArgs({ targetUserId: "user-1" }));

      expect(convertAccountToSso).toHaveBeenCalledWith({
        userId: "user-1",
        actorUserId: ADMIN_ID,
      });
      expect(result).toEqual(
        expect.objectContaining({
          result: expect.objectContaining({ status: "converted" }),
        })
      );
    });

    it("answers with the engine's status when the conversion is refused", async () => {
      vi.mocked(convertAccountToSso).mockRejectedValue(
        new ShelfError({
          cause: null,
          message: "Workspace owners cannot be converted to SSO.",
          label: "SSO",
          status: 400,
          shouldBeCaptured: false,
        })
      );

      const response = await action(actionArgs({ targetUserId: "owner-1" }));
      const body = (await asResponse(response).json()) as {
        error?: { message?: string };
      };

      expect(asResponse(response).status).toBe(400);
      expect(body.error?.message).toBe(
        "Workspace owners cannot be converted to SSO."
      );
    });

    it("refuses a submission without a target user", async () => {
      const response = await action(actionArgs({}));

      expect(asResponse(response).status).toBe(400);
      expect(convertAccountToSso).not.toHaveBeenCalled();
    });
  });
});
