// @vitest-environment node
/**
 * Server-side authorization test for the asset activity (notes) loader.
 *
 * The loader used to gate on `asset:read` and then hand every note back in the
 * page payload, leaving `note:read` to a check in the component. BASE and
 * SELF_SERVICE hold `asset: [read]` and `note: []`, so both roles received the
 * full note list and it was hidden only by React — a server-side authorization
 * gap, not a display bug.
 *
 * These tests drive the real `Role2PermissionMap` through a `requirePermission`
 * stub, so they assert the actual role matrix rather than a restatement of it:
 * a role without `note:read` must be rejected BEFORE any note is read, and a
 * role with it must still get its notes.
 *
 * @see {@link file://../../../app/routes/_layout+/assets.$assetId.activity.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
  Role2PermissionMap,
} from "~/utils/permissions/permission.data";

const { getAsset, getPaginatedAndFilterableAssetNotes, requirePermission } =
  vi.hoisted(() => ({
    getAsset: vi.fn(),
    getPaginatedAndFilterableAssetNotes: vi.fn(),
    requirePermission: vi.fn(),
  }));

// why: the loader's only authorization call. Stubbed so each test can drive it
// with a different role while still resolving against the REAL permission
// matrix (see `actAs` below) — that keeps the assertion honest if the matrix
// changes.
vi.mock("~/utils/roles.server", () => ({ requirePermission }));

// why: both are DB reads; we only care about WHETHER they run, not what they
// return.
vi.mock("~/modules/asset/service.server", () => ({ getAsset }));
vi.mock("~/modules/note/service.server", () => ({
  getPaginatedAndFilterableAssetNotes,
}));

// why: the success path serializes a per-page cookie preference, which needs a
// signing secret from the environment. Orthogonal to authorization.
vi.mock("~/utils/cookies.server", () => ({
  setCookie: vi.fn().mockReturnValue(["Set-Cookie", "perPage=20"]),
  userPrefs: { serialize: vi.fn().mockResolvedValue("perPage=20") },
}));

import { loader } from "~/routes/_layout+/assets.$assetId.activity";

/**
 * Points the `requirePermission` stub at a role, resolving each call against
 * the real `Role2PermissionMap` (with the ADMIN/OWNER allow-all short-circuit
 * the server applies) and throwing a 403-shaped error when the role lacks the
 * requested permission.
 */
function actAs(role: OrganizationRoles) {
  requirePermission.mockImplementation(
    ({
      entity,
      action,
    }: {
      entity: PermissionEntity;
      action: PermissionAction;
    }) => {
      const isAdminOrOwner =
        role === OrganizationRoles.ADMIN || role === OrganizationRoles.OWNER;
      const granted = Role2PermissionMap[role]?.[entity] ?? [];

      if (!isAdminOrOwner && !granted.includes(action)) {
        // why: a real `ShelfError`, not a bare Error — `validatePermission`
        // throws exactly this shape, and the loader's `makeShelfError` only
        // preserves the 403 for a ShelfError (anything else becomes a generic
        // 500). A bare Error would let the denial assertion pass while the
        // route actually surfaced the wrong status.
        return Promise.reject(
          new ShelfError({
            cause: null,
            title: "Unauthorized",
            message: "You have no permission to perform this action",
            status: 403,
            label: "Permission",
            shouldBeCaptured: false,
          })
        );
      }

      return Promise.resolve({
        organizationId: "org-1",
        userOrganizations: [],
        role,
      });
    }
  );
}

/** Minimal loader args for `/assets/asset-1/activity`. */
function loaderArgs() {
  return {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request("http://localhost/assets/asset-1/activity"),
    params: { assetId: "asset-1" },
  } as unknown as Parameters<typeof loader>[0];
}

describe("asset activity loader — note:read is enforced server-side", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAsset.mockResolvedValue({ id: "asset-1", title: "Camera" });
    getPaginatedAndFilterableAssetNotes.mockResolvedValue({
      page: 1,
      perPage: 20,
      search: null,
      items: [{ id: "note-1", content: "Serial number is 8891-B" }],
      totalItems: 1,
      totalPages: 1,
      hasNotes: true,
      cookie: { perPage: 20 },
    });
  });

  it("requires note:read for the data it returns", async () => {
    actAs(OrganizationRoles.OWNER);

    await loader(loaderArgs());

    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.note,
        action: PermissionAction.read,
      })
    );
  });

  it("gates asset:read BEFORE note:read, and resolves the asset in between", async () => {
    actAs(OrganizationRoles.OWNER);

    await loader(loaderArgs());

    /**
     * Ordering is load-bearing, not incidental. `getAsset` is what detects an
     * asset living in another of the user's workspaces and hands off to the
     * switch-workspace path. If `note:read` were checked first, a deep link to
     * such an asset would 403 for a role without note rights in the SELECTED
     * workspace, even when they hold them in the asset's own workspace.
     *
     * Asserting on call order rather than on the calls existing is the only
     * way this regression gets caught — the previous shape passed every other
     * assertion in this file.
     */
    const entities = vi
      .mocked(requirePermission)
      .mock.calls.map(([args]) => args.entity);

    expect(entities).toEqual([PermissionEntity.asset, PermissionEntity.note]);

    const assetGateOrder =
      vi.mocked(requirePermission).mock.invocationCallOrder[0];
    const noteGateOrder =
      vi.mocked(requirePermission).mock.invocationCallOrder[1];
    const getAssetOrder = vi.mocked(getAsset).mock.invocationCallOrder[0];

    expect(assetGateOrder).toBeLessThan(getAssetOrder);
    expect(getAssetOrder).toBeLessThan(noteGateOrder);
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "rejects %s and never reads a single note",
    async (role) => {
      // Precondition: this is exactly the gap. The role CAN read the asset but
      // has no note permission at all.
      expect(Role2PermissionMap[role]?.[PermissionEntity.asset]).toContain(
        PermissionAction.read
      );
      expect(Role2PermissionMap[role]?.[PermissionEntity.note]).toEqual([]);

      actAs(role);

      // The loader rethrows as `data(..., { status })`. Assert the observable
      // outcome is a 403 specifically — `toBeDefined()` alone would also pass
      // on a parse error or a 500 from error mapping, which is not the denial
      // this test is about.
      const thrown = await loader(loaderArgs()).then(
        () => null,
        (caught: unknown) => caught
      );

      expect((thrown as { init?: { status?: number } })?.init?.status).toBe(
        403
      );

      // The point of the fix: the notes are never fetched, so they can never
      // reach the payload. A client-side check would have let this call run.
      expect(getPaginatedAndFilterableAssetNotes).not.toHaveBeenCalled();
    }
  );

  it("still returns notes for a role that holds note:read", async () => {
    actAs(OrganizationRoles.ADMIN);

    // `data()` returns a DataWithResponseInit wrapper, not a Response.
    const result = (await loader(loaderArgs())) as unknown as {
      data: { items: unknown[] };
    };

    expect(getPaginatedAndFilterableAssetNotes).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-1", organizationId: "org-1" })
    );
    expect(result.data.items).toHaveLength(1);
  });
});
