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
 * @see {@link file://./assets.$assetId.activity.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { loader } from "./assets.$assetId.activity";

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
        return Promise.reject(
          Object.assign(new Error("You have no permission"), { status: 403 })
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

  it("asks for note:read, not asset:read", async () => {
    actAs(OrganizationRoles.OWNER);

    await loader(loaderArgs());

    // The parent route already enforces `asset:read`; this child must require
    // the permission for the data it actually returns.
    expect(requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: PermissionEntity.note,
        action: PermissionAction.read,
      })
    );
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

      await expect(loader(loaderArgs())).rejects.toBeDefined();

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
