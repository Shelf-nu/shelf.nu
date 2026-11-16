// @vitest-environment node
/**
 * Route tests for GET /api/mobile/me.
 *
 * Pins the contract the companion depends on to resolve `RoleAccess` and the
 * permission matrix for each of the user's workspaces: every organization in
 * the response must carry the four workspace visibility toggles
 * (`selfServiceCanSeeBookings`, `baseUserCanSeeBookings`,
 * `selfServiceCanSeeCustody`, `baseUserCanSeeCustody`) and the permission
 * switch `managersCanEditAssets`, and the query that builds the response must
 * actually select them, or the field is always `undefined` however correct
 * the route's mapping is.
 *
 * It also pins the additive workspace state (`inactive`, `inactiveReason`,
 * `inactiveMessage`): worked out from the same membership read, kept apart
 * from the gate's own columns, and reported active when it cannot be worked
 * out, so `/me` never fails for it.
 *
 * @see apps/webapp/app/routes/api+/mobile+/me.ts
 * @see apps/webapp/app/modules/api/mobile-auth.server.ts (getUserOrganizations)
 */
import { createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";

// why: React Router v7's single-fetch `data()` returns a DataWithResponseInit,
// not a Response. Mapping it to a real Response matches the rest of this suite.
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
          },
        })
    )
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: requireMobileAuth validates a Bearer JWT against Supabase Admin, which
// has no service to reach under `pnpm test:run`. getUserOrganizations (the
// query under test) is left real, so it runs against the mocked Prisma
// client below, exactly as the route calls it.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<
    typeof import("~/modules/api/mobile-auth.server")
  >("~/modules/api/mobile-auth.server");
  return {
    ...actual,
    requireMobileAuth: vi.fn().mockResolvedValue({
      user: {
        id: "user-1",
        email: "caller@example.com",
        firstName: "Caller",
        lastName: "User",
        displayName: null,
        profilePicture: null,
        onboarded: true,
        dateFormat: null,
        timeFormat: null,
        weekStart: null,
        timeZone: null,
      },
    }),
  };
});

// why: getUserOrganizations reads userOrganization rows directly; only that
// one query needs a stub for the loader to run.
vi.mock("~/database/db.server", () => ({
  db: { userOrganization: { findMany: vi.fn() } },
}));

// why: the state-read fallback logs; one test asserts that it does, and no
// other test may reach it.
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

const findMany = vi.mocked(db.userOrganization.findMany);

beforeEach(() => {
  vi.clearAllMocks();
});

const { loader } = await import("~/routes/api+/mobile+/me");

/** A findMany row in the shape `getUserOrganizations` selects. */
function row(organizationOverrides: Record<string, unknown> = {}) {
  return {
    roles: ["BASE"],
    user: { sso: false, lastSelectedOrganizationId: null, roles: [] },
    organization: {
      // What the workspace gate reads: an active Team workspace.
      userId: "owner-1",
      workspaceDisabled: false,
      owner: { tier: { tierLimitId: "tier_2" } },
      id: "org-1",
      name: "Org One",
      type: "TEAM",
      imageId: null,
      barcodesEnabled: false,
      auditsEnabled: false,
      currency: "EUR",
      selfServiceCanSeeBookings: false,
      baseUserCanSeeBookings: false,
      selfServiceCanSeeCustody: false,
      baseUserCanSeeCustody: true,
      managersCanEditAssets: false,
      ...organizationOverrides,
    },
  };
}

/** Invokes the loader with the arg shape React Router passes. */
function invoke(): Promise<Response> {
  return loader(
    createLoaderArgs({
      request: new Request("http://localhost/api/mobile/me"),
    })
  ) as unknown as Promise<Response>;
}

describe("GET /api/mobile/me", () => {
  it("selects all four workspace visibility toggles from the database", async () => {
    findMany.mockResolvedValue([row()] as never);

    await invoke();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          organization: expect.objectContaining({
            select: expect.objectContaining({
              selfServiceCanSeeBookings: true,
              baseUserCanSeeBookings: true,
              selfServiceCanSeeCustody: true,
              baseUserCanSeeCustody: true,
            }),
          }),
        }),
      })
    );
  });

  it("carries the four toggles on every organization in the response", async () => {
    findMany.mockResolvedValue([row()] as never);

    const response = await invoke();
    const body = (await response.json()) as {
      organizations: Array<Record<string, unknown>>;
    };

    expect(body.organizations).toHaveLength(1);
    expect(body.organizations[0]).toMatchObject({
      selfServiceCanSeeBookings: false,
      baseUserCanSeeBookings: false,
      selfServiceCanSeeCustody: false,
      baseUserCanSeeCustody: true,
    });
  });

  it("selects the Managers permission switch from the database", async () => {
    findMany.mockResolvedValue([row()] as never);

    await invoke();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          organization: expect.objectContaining({
            select: expect.objectContaining({ managersCanEditAssets: true }),
          }),
        }),
      })
    );
  });

  it("carries each organization's own Managers switch", async () => {
    findMany.mockResolvedValue([
      row({ managersCanEditAssets: true }),
      {
        ...row(),
        organization: { ...row().organization, id: "org-2", name: "Org Two" },
      },
    ] as never);

    const response = await invoke();
    const body = (await response.json()) as {
      organizations: Array<Record<string, unknown>>;
    };

    expect(
      body.organizations.map((org) => [org.id, org.managersCanEditAssets])
    ).toEqual([
      ["org-1", true],
      ["org-2", false],
    ]);
  });

  it("keeps each organization's toggles independent", async () => {
    findMany.mockResolvedValue([
      row({ selfServiceCanSeeBookings: true }),
    ] as never);

    const response = await invoke();
    const body = (await response.json()) as {
      organizations: Array<Record<string, unknown>>;
    };

    expect(body.organizations[0]).toMatchObject({
      selfServiceCanSeeBookings: true,
      baseUserCanSeeBookings: false,
      selfServiceCanSeeCustody: false,
    });
  });

  it("sends each workspace's currency, which the companion prefixes money with", async () => {
    findMany.mockResolvedValue([
      row(),
      row({ id: "org-2", currency: "JPY" }),
    ] as never);

    const response = await invoke();
    const body = (await response.json()) as {
      organizations: Array<Record<string, unknown>>;
    };

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          organization: expect.objectContaining({
            select: expect.objectContaining({ currency: true }),
          }),
        }),
      })
    );
    expect(body.organizations.map((org) => org.currency)).toEqual([
      "EUR",
      "JPY",
    ]);
  });

  it("sends each organization in the shape the companion resolves access from", async () => {
    // Keep in step with meOrganization() in apps/companion/lib/role-access.test.ts
    findMany.mockResolvedValue([row()] as never);

    const response = await invoke();
    const body = (await response.json()) as {
      organizations: Array<Record<string, unknown>>;
    };
    const org = body.organizations[0];

    expect(Object.keys(org)).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "type",
        "roles",
        "barcodesEnabled",
        "auditsEnabled",
        "selfServiceCanSeeBookings",
        "baseUserCanSeeBookings",
        "selfServiceCanSeeCustody",
        "baseUserCanSeeCustody",
        "managersCanEditAssets",
      ])
    );
    expect(Array.isArray(org.roles)).toBe(true);
    for (const toggle of [
      "selfServiceCanSeeBookings",
      "baseUserCanSeeBookings",
      "selfServiceCanSeeCustody",
      "baseUserCanSeeCustody",
      "managersCanEditAssets",
    ] as const) {
      expect(typeof org[toggle]).toBe("boolean");
    }
  });

  it("adds each workspace's state from the same read, without the gate's own columns", async () => {
    findMany.mockResolvedValue([
      row(),
      row({ id: "org-2", name: "Org Two", workspaceDisabled: true }),
    ] as never);

    const response = await invoke();
    const body = (await response.json()) as {
      organizations: Array<Record<string, unknown>>;
    };

    expect(
      body.organizations.map((org) => [
        org.id,
        org.inactive,
        org.inactiveReason,
        org.inactiveMessage,
        org.currency,
      ])
    ).toEqual([
      ["org-1", false, null, null, "EUR"],
      [
        "org-2",
        true,
        "disabled",
        "This workspace has been disabled. Contact Shelf support for more information.",
        "EUR",
      ],
    ]);
    for (const org of body.organizations) {
      expect(org).not.toHaveProperty("userId");
      expect(org).not.toHaveProperty("workspaceDisabled");
      expect(org).not.toHaveProperty("owner");
    }
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("still answers when a workspace's state cannot be worked out, reporting it active", async () => {
    // why: cast, an owner row without its tier is the failure under test.
    findMany.mockResolvedValue([row({ owner: null })] as never);

    const response = await invoke();
    const body = (await response.json()) as {
      organizations: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(body.organizations[0]).toMatchObject({
      id: "org-1",
      inactive: false,
    });
    expect(Logger.error).toHaveBeenCalledTimes(1);
  });
});
