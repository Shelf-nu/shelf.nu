/**
 * Audits index loader: the `assetId` scope.
 *
 * `/audits?assetId=<id>` lists one asset's audits, archived ones included. The
 * asset must belong to the caller's workspace; a foreign id is a 404 that
 * reveals nothing about the asset. Only callers who see every audit may scope
 * by asset; for anyone else the parameter is ignored, so it cannot reveal an
 * asset's name or existence.
 *
 * @see {@link file://../../../app/routes/_layout+/audits._index.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { permissionContext } from "@helpers/role-access";

import { db } from "~/database/db.server";
import { getAuditsForOrganization } from "~/modules/audit/service.server";
import { loader } from "~/routes/_layout+/audits._index";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the permission gate is exercised elsewhere; this test feeds its result
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the audit list is database work; the test asserts what the loader asks for
vi.mock("~/modules/audit/service.server", () => ({
  getAuditsForOrganization: vi.fn(),
}));

// why: the asset lookup is database work; org scoping is asserted on the call
vi.mock("~/database/db.server", () => ({
  db: { asset: { findFirst: vi.fn() } },
}));

// why: the per-page cookie needs no real cookie jar here
vi.mock("~/utils/cookies.server", () => ({
  updateCookieWithPerPage: vi.fn(async () => ({ perPage: 20 })),
  userPrefs: { serialize: vi.fn(async () => "") },
  setCookie: vi.fn(() => ["Set-Cookie", ""]),
}));

const context = {
  getSession: () => ({ userId: "caller" }),
} as unknown as Parameters<typeof loader>[0]["context"];

/** Runs the loader for `query` and reports the status plus payload on success. */
async function load(query: string) {
  try {
    const res = await loader(
      createLoaderArgs({
        request: new Request(`http://localhost:3000/audits${query}`),
        context,
      })
    );
    return {
      status: 200,
      data: (res as unknown as { data: Record<string, unknown> }).data,
    };
  } catch (e) {
    return { status: (e as { init?: { status?: number } }).init?.status };
  }
}

describe("audits index loader asset filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue(
      permissionContext({ roles: ["ADMIN"] }) as unknown as Awaited<
        ReturnType<typeof requirePermission>
      >
    );
    vi.mocked(getAuditsForOrganization).mockResolvedValue({
      audits: [],
      totalAudits: 0,
    } as unknown as Awaited<ReturnType<typeof getAuditsForOrganization>>);
  });

  it("rejects an asset from another workspace", async () => {
    vi.mocked(db.asset.findFirst).mockResolvedValue(null);

    const r = await load("?assetId=foreign-asset");

    expect(r.status).toBe(404);
    expect(db.asset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "foreign-asset",
          organizationId: "org-1",
        }),
      })
    );
    expect(getAuditsForOrganization).not.toHaveBeenCalled();
  });

  it("scopes to a valid asset and includes archived audits", async () => {
    vi.mocked(db.asset.findFirst).mockResolvedValue({
      id: "asset-1",
      title: "Camera",
    } as Awaited<ReturnType<typeof db.asset.findFirst>>);

    const r = await load("?assetId=asset-1");

    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({
      assetFilter: { id: "asset-1", title: "Camera" },
    });
    expect(getAuditsForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1", includeArchived: true })
    );
  });

  it("keeps archived audits hidden when an explicit status is chosen", async () => {
    vi.mocked(db.asset.findFirst).mockResolvedValue({
      id: "asset-1",
      title: "Camera",
    } as Awaited<ReturnType<typeof db.asset.findFirst>>);

    await load("?assetId=asset-1&status=ACTIVE");

    expect(getAuditsForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACTIVE", includeArchived: false })
    );
  });

  it("ignores an empty assetId", async () => {
    const r = await load("?assetId=");

    expect(r.status).toBe(200);
    expect(db.asset.findFirst).not.toHaveBeenCalled();
    expect(r.data).toMatchObject({ assetFilter: null });
  });

  it.each(["BASE", "SELF_SERVICE"] as const)(
    "ignores assetId for a %s caller who cannot see every audit",
    async (role) => {
      vi.mocked(requirePermission).mockResolvedValue(
        permissionContext({ roles: [role] }) as unknown as Awaited<
          ReturnType<typeof requirePermission>
        >
      );

      const r = await load("?assetId=asset-1");

      expect(r.status).toBe(200);
      expect(db.asset.findFirst).not.toHaveBeenCalled();
      expect(r.data).toMatchObject({ assetFilter: null });
      expect(getAuditsForOrganization).toHaveBeenCalledWith(
        expect.objectContaining({
          assignedOnly: true,
          assetId: null,
          includeArchived: false,
        })
      );
    }
  );
});
