/**
 * Command-palette search returns each entity type to members whose matrix
 * grant covers reading it: kits to anyone with kit:read, locations and team
 * members to OWNER and ADMIN only, and audits limited to assigned ones for
 * members who cannot see every audit. Asset results never name a custodian
 * the caller may not see.
 *
 * @see {@link file://../../../app/routes/api+/command-palette.search.ts}
 */
// @vitest-environment node
import type { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { permissionContext } from "@helpers/role-access";
import { createLoaderArgs } from "@mocks/remix";
import { db } from "~/database/db.server";
import { requirePermission } from "~/utils/roles.server";

const state = vi.hoisted(() => ({ roles: ["SELF_SERVICE"] as string[] }));

// why: the membership under test is supplied here; the route's own decisions run for real
vi.mock("~/utils/roles.server", async () => {
  const { permissionContext } = await import("@helpers/role-access");
  return {
    requirePermission: vi.fn(async () =>
      permissionContext({ roles: state.roles as OrganizationRoles[] })
    ),
  };
});

// why: every search is a database query; the test observes which ones run
vi.mock("~/database/db.server", () => ({
  db: {
    kit: {
      findMany: vi.fn(async () => [
        {
          id: "kit-1",
          name: "Kit",
          description: null,
          status: "AVAILABLE",
          _count: { assetKits: 0 },
        },
      ]),
    },
    booking: { findMany: vi.fn(async () => []) },
    location: { findMany: vi.fn(async () => []) },
    teamMember: { findMany: vi.fn(async () => []) },
    auditSession: { findMany: vi.fn(async () => []) },
  },
}));

// why: asset search has its own service tests
vi.mock("~/modules/asset/service.server", () => ({
  getAssets: vi.fn(async () => ({ assets: [] })),
}));

// why: booking scope needs team-member lookups; this test is about kits,
// locations, team members and audits
vi.mock("~/modules/booking/service.server", () => ({
  resolveCustodianScope: vi.fn(async () => ({})),
  custodianScopeClause: vi.fn(() => ({})),
}));

const { loader } = await import("~/routes/api+/command-palette.search");
const { getAssets } = await import("~/modules/asset/service.server");

async function search(roles: string[]) {
  state.roles = roles;
  return loader(
    createLoaderArgs({
      request: new Request("http://localhost/api/command-palette/search?q=kit"),
      context: { getSession: () => ({ userId: "caller" }) } as never,
    })
  );
}

describe("command-palette search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([["SELF_SERVICE"], ["BASE"], ["ADMIN"]])(
    "%s gets kits (kit:read)",
    async (role) => {
      await search([role]);
      expect(db.kit.findMany).toHaveBeenCalled();
    }
  );

  it.each([["SELF_SERVICE"], ["BASE"]])(
    "%s gets no locations or team members",
    async (role) => {
      await search([role]);
      expect(db.location.findMany).not.toHaveBeenCalled();
      expect(db.teamMember.findMany).not.toHaveBeenCalled();
    }
  );

  it("ADMIN beside SELF_SERVICE gets locations and team members", async () => {
    await search(["SELF_SERVICE", "ADMIN"]);
    expect(db.location.findMany).toHaveBeenCalled();
    expect(db.teamMember.findMany).toHaveBeenCalled();
  });

  it("a restricted member's audit search is limited to assigned audits", async () => {
    await search(["BASE"]);
    const [{ where }] = vi.mocked(db.auditSession.findMany).mock
      .calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(where.assignments).toEqual({ some: { userId: "caller" } });
  });

  it("an ADMIN's audit search is not limited to assignments", async () => {
    await search(["ADMIN"]);
    const [{ where }] = vi.mocked(db.auditSession.findMany).mock
      .calls[0] as unknown as [{ where: Record<string, unknown> }];
    expect(where).not.toHaveProperty("assignments");
  });

  it("a restricted-custody caller's team-member search still applies the text search", async () => {
    // why: no current role holds teamMember:read without custody.seeAll, so
    // this crafts the access shape by hand to exercise the combination the
    // next role to gain that pairing (Manager) will produce.
    const context = permissionContext({ roles: ["ADMIN"] });
    vi.mocked(requirePermission).mockResolvedValueOnce({
      ...context,
      access: {
        ...context.access,
        custody: { ...context.access.custody, seeAll: false },
      },
    } as Awaited<ReturnType<typeof requirePermission>>);

    await search(["ADMIN"]);

    const [{ where }] = vi.mocked(db.teamMember.findMany).mock
      .calls[0] as unknown as [{ where: Record<string, unknown> }];
    // The custody scope must narrow the results without discarding the text
    // search: both conditions have to survive combined under one `AND`.
    expect(JSON.stringify(where)).toContain('"contains":"kit"');
    expect(JSON.stringify(where)).toContain('"userId":"caller"');
  });

  it("searches only bookable assets for SELF_SERVICE", async () => {
    await search(["SELF_SERVICE"]);
    expect(vi.mocked(getAssets).mock.calls[0][0]).toMatchObject({
      availableToBookOnly: true,
    });
  });

  it.each([["BASE"], ["ADMIN"]])(
    "searches every asset for %s",
    async (role) => {
      await search([role]);
      expect(vi.mocked(getAssets).mock.calls[0][0]).toMatchObject({
        availableToBookOnly: false,
      });
    }
  );

  /** An asset found by search, held by the given custodian user. */
  function assetHeldBy(holderUserId: string) {
    return {
      id: "asset-1",
      title: "Camera",
      sequentialId: null,
      mainImage: null,
      thumbnailImage: null,
      assetModel: null,
      assetLocations: [],
      qrCodes: [],
      tags: [],
      barcodes: [],
      customFields: [],
      category: null,
      description: null,
      custody: [
        {
          quantity: 1,
          custodian: {
            name: "Holder Name",
            userId: holderUserId,
            user: {
              id: holderUserId,
              firstName: "Holder",
              lastName: "Name",
              displayName: "Holder Name",
              email: "holder@example.com",
            },
          },
        },
      ],
    };
  }

  /** The asset rows the search answered with. */
  async function assetsFound(roles: string[]) {
    const response = (await search(roles)) as unknown as {
      data: {
        assets: {
          custodianName: string | null;
          custodianUserName: string | null;
        }[];
      };
    };
    return response.data.assets;
  }

  it("withholds another member's name from a caller who cannot see all custody", async () => {
    vi.mocked(getAssets).mockResolvedValueOnce({
      assets: [assetHeldBy("someone-else")],
    } as never);

    const [asset] = await assetsFound(["BASE"]);

    expect(asset.custodianName).toBeFalsy();
    expect(asset.custodianUserName).toBeFalsy();
  });

  it("still names the caller's own custody to a restricted caller", async () => {
    vi.mocked(getAssets).mockResolvedValueOnce({
      assets: [assetHeldBy("caller")],
    } as never);

    const [asset] = await assetsFound(["BASE"]);

    expect(asset.custodianName).toBe("Holder Name");
  });

  it("names any custodian to ADMIN", async () => {
    vi.mocked(getAssets).mockResolvedValueOnce({
      assets: [assetHeldBy("someone-else")],
    } as never);

    const [asset] = await assetsFound(["ADMIN"]);

    expect(asset.custodianName).toBe("Holder Name");
    expect(asset.custodianUserName).toBe("Holder Name");
  });
});
