// @vitest-environment node
/**
 * Route tests for GET /api/mobile/me.
 *
 * Pins the contract the companion depends on to resolve `RoleAccess` for
 * each of the user's workspaces: every organization in the response must
 * carry the four workspace visibility toggles (`selfServiceCanSeeBookings`,
 * `baseUserCanSeeBookings`, `selfServiceCanSeeCustody`,
 * `baseUserCanSeeCustody`), and the query that builds the response must
 * actually select them, or the field is always `undefined` however correct
 * the route's mapping is.
 *
 * @see apps/webapp/app/routes/api+/mobile+/me.ts
 * @see apps/webapp/app/modules/api/mobile-auth.server.ts (getUserOrganizations)
 */
import { createLoaderArgs } from "@mocks/remix";
import { describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";

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

const findMany = vi.mocked(db.userOrganization.findMany);

const { loader } = await import("~/routes/api+/mobile+/me");

/** A findMany row in the shape `getUserOrganizations` selects. */
function row(organizationOverrides: Partial<Record<string, boolean>> = {}) {
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
      selfServiceCanSeeBookings: false,
      baseUserCanSeeBookings: false,
      selfServiceCanSeeCustody: false,
      baseUserCanSeeCustody: true,
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
      ])
    );
    expect(Array.isArray(org.roles)).toBe(true);
    for (const toggle of [
      "selfServiceCanSeeBookings",
      "baseUserCanSeeBookings",
      "selfServiceCanSeeCustody",
      "baseUserCanSeeCustody",
    ] as const) {
      expect(typeof org[toggle]).toBe("boolean");
    }
  });
});
