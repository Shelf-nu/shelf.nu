/**
 * Asset audit history route: who may read it and which assets they may ask about.
 *
 * @see {@link file://./../../../app/routes/api+/assets.$assetId.audit-history.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { permissionContext } from "@helpers/role-access";

import { getAssetAuditHistory } from "~/modules/audit/asset-audit-history.server";
import { ShelfError } from "~/utils/error";
import { assertAssetsBelongToOrg } from "~/utils/org-validation.server";
import * as rolesServer from "~/utils/roles.server";

import { loader } from "~/routes/api+/assets.$assetId.audit-history";

// @vitest-environment node

// why: the route imports the real Prisma client transitively; every read goes
// through the services stubbed below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the permission check reads the session cookie and the database; the
// cases vary only its result.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the premium flag comes from the environment; the add-on rule is
// reduced to the workspace's own flag.
vi.mock("~/utils/subscription.server", () => ({
  canUseAudits: (org: { auditsEnabled: boolean }) => org.auditsEnabled,
}));

// why: the history queries hit the database; their shape is pinned in the
// service's own test.
vi.mock("~/modules/audit/asset-audit-history.server", () => ({
  getAssetAuditHistory: vi.fn(),
}));

// why: the org guard queries the database; its refusal is simulated.
vi.mock("~/utils/org-validation.server", () => ({
  assertAssetsBelongToOrg: vi.fn(),
}));

/** Grants the caller `roles` in a workspace whose audit add-on is on or off. */
function grant(roles: ("ADMIN" | "BASE")[], auditsEnabled: boolean) {
  const ctx = permissionContext({ roles });
  vi.mocked(rolesServer.requirePermission).mockResolvedValue({
    ...ctx,
    currentOrganization: { ...ctx.currentOrganization, auditsEnabled },
  } as never);
}

/** Calls the loader and returns the thrown or returned response. */
async function call() {
  const args = createLoaderArgs({
    request: new Request("http://localhost/api/assets/asset-1/audit-history"),
    params: { assetId: "asset-1" },
    context: { getSession: () => ({ userId: "user-1" }) } as never,
  });
  try {
    return (await loader(args)) as unknown as {
      data: unknown;
      init?: { status?: number } | null;
    };
  } catch (thrown) {
    return thrown as { data: unknown; init?: { status?: number } | null };
  }
}

describe("asset audit history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so reset the guard to pass.
    vi.mocked(assertAssetsBelongToOrg).mockResolvedValue(undefined);
    vi.mocked(getAssetAuditHistory).mockResolvedValue({
      recent: [],
      upcoming: [],
    });
  });

  it("answers 403 to a role that cannot see all audits", async () => {
    grant(["BASE"], true);

    const response = await call();

    expect(response.init?.status).toBe(403);
    expect(getAssetAuditHistory).not.toHaveBeenCalled();
  });

  it("answers 403 when the workspace has no audit add-on", async () => {
    grant(["ADMIN"], false);

    const response = await call();

    expect(response.init?.status).toBe(403);
    expect(getAssetAuditHistory).not.toHaveBeenCalled();
  });

  it("refuses an asset from another workspace with the org guard's status", async () => {
    grant(["ADMIN"], true);
    vi.mocked(assertAssetsBelongToOrg).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "Some of the selected assets do not exist",
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      })
    );

    const response = await call();

    expect(response.init?.status).toBe(400);
    expect(getAssetAuditHistory).not.toHaveBeenCalled();
  });

  it("returns the recent and upcoming audits to an admin with the add-on", async () => {
    grant(["ADMIN"], true);

    const response = await call();

    expect(assertAssetsBelongToOrg).toHaveBeenCalledWith({
      assetIds: ["asset-1"],
      organizationId: "org-1",
    });
    expect(getAssetAuditHistory).toHaveBeenCalledWith({
      assetId: "asset-1",
      organizationId: "org-1",
    });
    expect(response.data).toEqual({ error: null, recent: [], upcoming: [] });
  });
});
