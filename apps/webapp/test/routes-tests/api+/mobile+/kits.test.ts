/**
 * Response-contract tests for the mobile kits list endpoint.
 *
 * A kit's `image` is a signed URL with a lifetime, and the companion's kits
 * list renders it as sent. So every kit on the page goes through
 * `refreshExpiredKitImages` before the response is shaped: a lapsed URL
 * arrives re-signed, with the `imageExpiration` the helper returned, and
 * `organizationId` (selected only to scope the helper's write-back) stays out
 * of the payload.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/kits.ts} for the loader under test
 * @see {@link file://../../../../app/modules/kit/service.server.ts} for `refreshExpiredKitImages`
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { refreshExpiredKitImages } from "~/modules/kit/service.server";

import { loader } from "~/routes/api+/mobile+/kits";

import { assertIsDataWithResponseInit } from "@helpers/assertions";

// @vitest-environment node

// why: db is the integration boundary — the loader reads one page of kits and
// the total count, and the test inspects the response shaped from them.
vi.mock("~/database/db.server", () => ({
  db: {
    kit: { findMany: vi.fn(), count: vi.fn() },
  },
}));

// why: `mobile-auth.server` transitively loads the Supabase admin client and
// the real Prisma client (no DB / env in unit tests). The route only calls
// these four gate functions, so only those are stubbed.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(),
  requireOrganizationAccess: vi.fn(),
  requireMobilePermission: vi.fn(),
  getMobileUserContext: vi.fn(),
}));

// why: re-signing calls Supabase Storage and writes the new URL back to the
// kit row. The helper has its own contract; this suite pins what the route
// does with it: hand over the page's rows, and send what comes back.
vi.mock("~/modules/kit/service.server", () => ({
  refreshExpiredKitImages: vi.fn((kits: unknown[]) => Promise.resolve(kits)),
}));

const findManyMock = vi.mocked(db.kit.findMany);
const countMock = vi.mocked(db.kit.count);
const requireMobileAuthMock = vi.mocked(requireMobileAuth);
const requireOrganizationAccessMock = vi.mocked(requireOrganizationAccess);
const requireMobilePermissionMock = vi.mocked(requireMobilePermission);
const getMobileUserContextMock = vi.mocked(getMobileUserContext);
const refreshExpiredKitImagesMock = vi.mocked(refreshExpiredKitImages);

const FAKE_USER_ID = "user-abc";
const FAKE_ORG_ID = "org-xyz";

/** One kit row as the list query selects it; override per test. */
function storedKit(overrides: {
  id: string;
  image: string | null;
  imageExpiration: Date | null;
}) {
  return {
    organizationId: FAKE_ORG_ID,
    name: `Kit ${overrides.id}`,
    status: "AVAILABLE",
    _count: { assetKits: 2 },
    category: null,
    location: null,
    custody: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  requireMobileAuthMock.mockResolvedValue({
    user: { id: FAKE_USER_ID },
  } as Awaited<ReturnType<typeof requireMobileAuth>>);
  requireOrganizationAccessMock.mockResolvedValue(FAKE_ORG_ID);
  requireMobilePermissionMock.mockResolvedValue(undefined);
  getMobileUserContextMock.mockResolvedValue({
    canSeeAllCustody: true,
  } as Awaited<ReturnType<typeof getMobileUserContext>>);
});

describe("GET /api/mobile/kits — kit images", () => {
  it("sends a lapsed kit image re-signed, with its new expiry", async () => {
    const lapsedKit = storedKit({
      id: "kit-lapsed",
      image: "https://example.test/sign/kits/lapsed.png?token=lapsed",
      imageExpiration: new Date("2020-01-01T00:00:00.000Z"),
    });
    const signedKit = storedKit({
      id: "kit-signed",
      image: "https://example.test/sign/kits/signed.png?token=valid",
      imageExpiration: new Date("2099-01-01T00:00:00.000Z"),
    });
    findManyMock.mockResolvedValueOnce([lapsedKit, signedKit] as never);
    countMock.mockResolvedValueOnce(2);
    const resignedImage =
      "https://example.test/sign/kits/lapsed.png?token=fresh";
    const newExpiration = new Date("2099-01-04T00:00:00.000Z");
    refreshExpiredKitImagesMock.mockResolvedValueOnce([
      { ...lapsedKit, image: resignedImage, imageExpiration: newExpiration },
      signedKit,
    ]);

    const response = await loader(
      createLoaderArgs({
        request: new Request("http://localhost:3000/api/mobile/kits"),
      })
    );
    assertIsDataWithResponseInit(response);
    const body = response.data as { kits: Array<Record<string, unknown>> };

    // The page goes to the helper as the query returned it — `organizationId`
    // included, since the helper scopes its write-back by it.
    expect(refreshExpiredKitImagesMock).toHaveBeenCalledWith([
      lapsedKit,
      signedKit,
    ]);
    expect(body.kits[0]).toMatchObject({
      id: "kit-lapsed",
      image: resignedImage,
      imageExpiration: newExpiration,
      // The rest of the shaping still applies to the re-signed row.
      _count: { assets: 2 },
    });
    expect(body.kits[1]).toMatchObject({
      id: "kit-signed",
      image: signedKit.image,
      imageExpiration: signedKit.imageExpiration,
    });
    // Selected for the write-back only; the app's kit shape has no such field.
    for (const kit of body.kits) {
      expect(kit).not.toHaveProperty("organizationId");
    }
  });
});
