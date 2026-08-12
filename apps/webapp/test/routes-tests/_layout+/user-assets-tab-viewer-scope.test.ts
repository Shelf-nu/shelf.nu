/**
 * Viewer-vs-subject wiring for the two user Assets tabs.
 *
 * `getUserAssetsTabLoaderData` injects `teamMember=<subject>` into the filter
 * string it hands to `getPaginatedAndFilterableAssets`. That filter is then
 * narrowed against the CALLER's own custody, so the helper needs two distinct
 * identities:
 *
 * - `userId` — the SUBJECT whose assets are listed (the profile being viewed).
 * - `viewerId` — the CALLER, i.e. the principal the narrowing measures against.
 *
 * Collapsing them is a bug in one direction and a vulnerability in the other:
 *
 * - Omitting `viewerId` (the shipped bug) makes the narrowing run with an empty
 *   principal, so the injected filter is refused and BOTH tabs render empty.
 * - Passing the SUBJECT as the viewer — the obvious reading of "pass the user
 *   id here" — would make the narrowing treat the requested custodian as the
 *   principal, letting any caller list any user's custody and re-opening the
 *   cross-user disclosure this branch exists to close.
 *
 * These tests pin the distinction at both call sites, because the two routes
 * disagree about what the subject is: on `/me/assets` viewer === subject, while
 * on the team-member profile they are different people.
 *
 * @see {@link file://./../../../app/modules/asset/service.server.ts} — `getUserAssetsTabLoaderData`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import * as assetService from "~/modules/asset/service.server";
import * as httpServer from "~/utils/http.server";
import * as rolesServer from "~/utils/roles.server";

// why: the subject is which identities reach the service, not what it returns.
vi.mock("~/modules/asset/service.server", () => ({
  getUserAssetsTabLoaderData: vi.fn(),
}));

// why: both routes render `AssetsList`, whose module graph pulls in lottie-web
// (which touches a canvas at import time) and the Prisma client. Only the
// loaders are under test here.
vi.mock("~/components/assets/assets-index/assets-list", () => ({
  AssetsList: () => null,
}));

vi.mock("~/database/db.server", () => ({ db: {} }));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/utils/http.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/http.server")>();
  return { ...actual, getParams: vi.fn() };
});

import { loader as meAssetsLoader } from "~/routes/_layout+/me.assets";
import { loader as teamMemberAssetsLoader } from "~/routes/_layout+/settings.team.users.$userId.assets";

const VIEWER = "viewer-user-id";
const SUBJECT = "some-other-user-id";

const mockContext = {
  getSession: () => ({ userId: VIEWER }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

/** `requirePermission` result with a caller-controlled custody visibility. */
function mockPermission(canSeeAllCustody: boolean) {
  vi.mocked(rolesServer.requirePermission).mockResolvedValue({
    organizationId: "org123",
    userOrganizations: [],
    isSelfServiceOrBase: !canSeeAllCustody,
    organizations: [],
    currentOrganization: {} as any,
    role: {} as any,
    canSeeAllBookings: false,
    canSeeAllCustody,
    canUseBarcodes: false,
    canUseAudits: false,
  });
}

describe("user Assets tab — viewer vs subject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assetService.getUserAssetsTabLoaderData).mockResolvedValue({
      headers: [],
      items: [],
    } as any);
  });

  describe("/me/assets", () => {
    it("passes the caller as BOTH subject and viewer", async () => {
      mockPermission(false);

      await meAssetsLoader(createLoaderArgs({ context: mockContext }));

      expect(assetService.getUserAssetsTabLoaderData).toHaveBeenCalledWith(
        expect.objectContaining({ userId: VIEWER, viewerId: VIEWER })
      );
    });

    it("forwards the caller's resolved custody visibility, not a fixed value", async () => {
      // Hardcoding `false` here was the shipped bug: with no viewer to match
      // against, the injected `teamMember=<self>` filter was refused and the
      // tab returned nothing.
      mockPermission(true);

      await meAssetsLoader(createLoaderArgs({ context: mockContext }));

      expect(assetService.getUserAssetsTabLoaderData).toHaveBeenCalledWith(
        expect.objectContaining({ canSeeAllCustody: true })
      );
    });
  });

  describe("/settings/team/users/$userId/assets", () => {
    beforeEach(() => {
      vi.mocked(httpServer.getParams).mockReturnValue({ userId: SUBJECT });
    });

    it("keeps the profile subject and the viewer distinct", async () => {
      mockPermission(true);

      await teamMemberAssetsLoader(
        createLoaderArgs({ context: mockContext, params: { userId: SUBJECT } })
      );

      // The trap: passing SUBJECT as `viewerId` would make the narrowing treat
      // the requested custodian as the principal, so any caller could list any
      // user's custody.
      expect(assetService.getUserAssetsTabLoaderData).toHaveBeenCalledWith(
        expect.objectContaining({ userId: SUBJECT, viewerId: VIEWER })
      );
    });

    it("forwards the caller's resolved custody visibility", async () => {
      // Only ADMIN/OWNER can open this route, and they resolve `true` — which
      // short-circuits the narrowing so the subject's assets are listed.
      mockPermission(true);

      await teamMemberAssetsLoader(
        createLoaderArgs({ context: mockContext, params: { userId: SUBJECT } })
      );

      expect(assetService.getUserAssetsTabLoaderData).toHaveBeenCalledWith(
        expect.objectContaining({ canSeeAllCustody: true })
      );
    });
  });
});
