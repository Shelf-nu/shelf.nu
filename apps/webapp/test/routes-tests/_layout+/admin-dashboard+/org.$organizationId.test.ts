/**
 * Admin organization route: the "Require SSO login" switch
 * (`toggleRequireSsoLogin` intent), which writes `SsoDetails.requireSsoLogin`
 * on the workspace's SSO setup; the SSO details form (`updateSsoDetails`
 * intent), which maps IdP groups to each of the four assignable roles; and the
 * admin gate.
 *
 * @see {@link file://./../../../../app/routes/_layout+/admin-dashboard+/org.$organizationId.tsx}
 * @see {@link file://./../../../../app/modules/organization/service.server.ts} setRequireSsoLogin
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/admin-dashboard+/org.$organizationId";
import { ShelfError } from "~/utils/error";

// why: the route's component tree imports lottie, which draws on a canvas at
// import time; happy-dom has no canvas.
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

// why: the switch is written through Prisma; each test sets the workspace's
// SSO details row and reads back what was written.
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    ssoDetails: { update: vi.fn() },
  },
}));
// why: requireAdmin reads the caller's roles from the database.
vi.mock("~/utils/roles.server", () => ({
  requireAdmin: vi.fn(),
}));

// why: the route answers failures with react-router's data(), which returns a
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

import { db } from "~/database/db.server";
import { requireAdmin } from "~/utils/roles.server";

/** The admin driving the page. */
const ADMIN_ID = "admin-1";
/** The workspace whose page is open. */
const ORG_ID = "org-1";

/**
 * Builds action args posting `fields` to the workspace's admin page.
 *
 * why: a URLSearchParams body, because happy-dom drops empty FormData fields on
 * the Request round-trip.
 */
function actionArgs(fields: Record<string, string>) {
  return {
    request: new Request(`http://localhost/admin-dashboard/org/${ORG_ID}`, {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
    params: { organizationId: ORG_ID },
    context: { getSession: () => ({ userId: ADMIN_ID }) },
  } as unknown as Parameters<typeof action>[0];
}

/** Reinterprets a result as the `Response` the mocked `data()` returns. */
function asResponse(value: unknown): Response {
  return value as Response;
}

/** Sets the SSO details row the workspace points at, or none. */
function givenSsoDetailsId(ssoDetailsId: string | null) {
  vi.mocked(db.organization.findUnique).mockResolvedValue({
    ssoDetailsId,
  } as unknown as Awaited<ReturnType<typeof db.organization.findUnique>>);
}

describe("admin org route: toggleRequireSsoLogin", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: ADMIN_ID });
    givenSsoDetailsId("sso-1");
  });

  it("turns Require SSO login on when the switch is checked", async () => {
    const result = await action(
      actionArgs({ intent: "toggleRequireSsoLogin", requireSsoLogin: "on" })
    );

    expect(db.ssoDetails.update).toHaveBeenCalledWith({
      where: { id: "sso-1" },
      data: { requireSsoLogin: true },
    });
    expect(result).toEqual(
      expect.objectContaining({ message: "Require SSO login on" })
    );
  });

  it("turns Require SSO login off when the switch is unchecked", async () => {
    // An unchecked switch submits no field at all.
    await action(actionArgs({ intent: "toggleRequireSsoLogin" }));

    expect(db.ssoDetails.update).toHaveBeenCalledWith({
      where: { id: "sso-1" },
      data: { requireSsoLogin: false },
    });
  });

  it("refuses a workspace with no SSO details with 400 and writes nothing", async () => {
    givenSsoDetailsId(null);

    const response = await action(
      actionArgs({ intent: "toggleRequireSsoLogin", requireSsoLogin: "on" })
    );

    expect(asResponse(response).status).toBe(400);
    expect(db.ssoDetails.update).not.toHaveBeenCalled();
  });

  it("refuses a non-admin with 403 and writes nothing", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You do not have permission to access this resource",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    const response = await action(
      actionArgs({ intent: "toggleRequireSsoLogin", requireSsoLogin: "on" })
    );

    expect(asResponse(response).status).toBe(403);
    expect(db.organization.findUnique).not.toHaveBeenCalled();
    expect(db.ssoDetails.update).not.toHaveBeenCalled();
  });
});

describe("admin org route: updateSsoDetails", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: ADMIN_ID });
  });

  /** The group columns the action wrote, read from the upsert's create arm. */
  function writtenGroups() {
    const call = vi.mocked(db.organization.update).mock.calls[0]?.[0] as {
      data: { ssoDetails: { upsert: { create: Record<string, unknown> } } };
    };
    return call.data.ssoDetails.upsert.create;
  }

  it("saves a workspace that maps only the Manager group", async () => {
    const result = await action(
      actionArgs({
        intent: "updateSsoDetails",
        domain: "example.com",
        adminGroupId: "",
        managerGroupId: "grp-manager",
        selfServiceGroupId: "",
        baseUserGroupId: "",
      })
    );

    expect(writtenGroups()).toEqual({
      domain: "example.com",
      adminGroupId: null,
      managerGroupId: "grp-manager",
      selfServiceGroupId: null,
      baseUserGroupId: null,
    });
    expect(result).toEqual(
      expect.objectContaining({ message: "SSO details updated" })
    );
  });

  it("saves all four role groups, trimmed", async () => {
    await action(
      actionArgs({
        intent: "updateSsoDetails",
        domain: "example.com",
        adminGroupId: " grp-admin ",
        managerGroupId: "grp-manager",
        selfServiceGroupId: "grp-self-service",
        baseUserGroupId: "grp-base",
      })
    );

    expect(writtenGroups()).toEqual({
      domain: "example.com",
      adminGroupId: "grp-admin",
      managerGroupId: "grp-manager",
      selfServiceGroupId: "grp-self-service",
      baseUserGroupId: "grp-base",
    });
  });

  it("refuses a setup with no group mapped with 400 and writes nothing", async () => {
    const response = await action(
      actionArgs({
        intent: "updateSsoDetails",
        domain: "example.com",
        adminGroupId: " ",
        managerGroupId: "",
        selfServiceGroupId: "",
        baseUserGroupId: "",
      })
    );

    expect(asResponse(response).status).toBe(400);
    const body = await asResponse(response).json();
    expect(body.error.message).toBe(
      "Map at least one group to a role. Only the roles you use need a group."
    );
    expect(db.organization.update).not.toHaveBeenCalled();
  });
});
