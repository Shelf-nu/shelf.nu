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
 * `inactiveMessage`): beside the existing fields, in the same order, and
 * reported active when the state read fails, so `/me` never fails for it.
 *
 * @see apps/webapp/app/routes/api+/mobile+/me.ts
 * @see apps/webapp/app/modules/api/mobile-auth.server.ts (getUserOrganizations)
 */
import { createLoaderArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { getMobileWorkspaceStates } from "~/modules/api/mobile-auth.server";
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
    // why: the workspace lapse rules behind it have their own tests
    // (mobile-auth.server.workspace-lapse.test.ts); here each test sets the
    // states the route merges in.
    getMobileWorkspaceStates: vi.fn(),
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
const workspaceStates = vi.mocked(getMobileWorkspaceStates);

beforeEach(() => {
  vi.clearAllMocks();
  workspaceStates.mockResolvedValue(new Map());
});

const { loader } = await import("~/routes/api+/mobile+/me");

/** A findMany row in the shape `getUserOrganizations` selects. */
function row(
  organizationOverrides: Partial<Record<string, boolean | string>> = {}
) {
  return {
    roles: ["BASE"],
    user: { sso: false, lastSelectedOrganizationId: null },
    organization: {
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

  it("adds each workspace's active state beside its existing fields, in the same order", async () => {
    findMany.mockResolvedValue([
      row(),
      row({ id: "org-2", name: "Org Two" }),
    ] as never);
    workspaceStates.mockResolvedValue(
      new Map([
        [
          "org-1",
          { inactive: false, inactiveReason: null, inactiveMessage: null },
        ],
        [
          "org-2",
          {
            inactive: true,
            inactiveReason: "lapsed",
            inactiveMessage: "This workspace is inactive.",
          },
        ],
      ])
    );

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
      ["org-2", true, "lapsed", "This workspace is inactive.", "EUR"],
    ]);
    expect(workspaceStates).toHaveBeenCalledWith({
      userId: "user-1",
      organizationIds: ["org-1", "org-2"],
    });
    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("reports a workspace the state read left out as active", async () => {
    findMany.mockResolvedValue([row()] as never);

    const response = await invoke();
    const body = (await response.json()) as {
      organizations: Array<Record<string, unknown>>;
    };

    expect(body.organizations[0]).toMatchObject({
      inactive: false,
      inactiveReason: null,
      inactiveMessage: null,
    });
  });

  it("still answers when the state read fails, reporting every workspace active", async () => {
    findMany.mockResolvedValue([row()] as never);
    workspaceStates.mockRejectedValue(new Error("connection reset"));

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
