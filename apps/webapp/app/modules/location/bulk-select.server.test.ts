/**
 * Location bulk "select all" — filter scope
 *
 * The bulk dialogs post to a bare `actionUrl` (`/locations/:id/assets`), so
 * inside the action `request.url` carries no query string. Deriving the user's
 * filters from it therefore yields an empty set, and "select all" silently
 * becomes "select everything at this location" — the user removes 100 items
 * having been shown 10.
 *
 * The filters must come from the submitted `currentSearchParams` field, which
 * the shared dialog has always sent.
 *
 * Regression coverage for detail.dev finding D109.
 *
 * @see {@link file://./bulk-select.server.ts}
 * @see {@link file://./../../components/bulk-update-dialog/bulk-update-dialog.tsx}
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { getKitsWhereInput } from "~/modules/kit/utils.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  resolveLocationAssetIds,
  resolveLocationKitIds,
} from "./bulk-select.server";

// @vitest-environment node

const dbMock = vi.hoisted(() => ({
  asset: { findMany: vi.fn() },
  kit: { findMany: vi.fn() },
}));

// why: the assertion is on the where-clause handed to Prisma, not on rows
vi.mock("~/database/db.server", () => ({ db: dbMock }));

// why: these build large filter objects of their own; this test only cares
// which search params reach them
vi.mock("~/modules/asset/utils.server", () => ({
  getAssetsWhereInput: vi.fn(() => ({ organizationId: "org-1" })),
}));
vi.mock("~/modules/kit/utils.server", () => ({
  getKitsWhereInput: vi.fn(() => ({ organizationId: "org-1" })),
}));

const ORG = "org-1";
const LOC = "loc-1";

describe("resolveLocationAssetIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.asset.findMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);
  });

  it("returns explicit ids untouched", async () => {
    const ids = await resolveLocationAssetIds({
      ids: ["a1", "a2"],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=laptop",
    });

    expect(ids).toEqual(["a1", "a2"]);
    // No expansion means no query at all
    expect(dbMock.asset.findMany).not.toHaveBeenCalled();
  });

  it("passes the submitted filters through on select all", async () => {
    await resolveLocationAssetIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=laptop&category=cat-1",
    });

    expect(getAssetsWhereInput).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        currentSearchParams: "s=laptop&category=cat-1",
      })
    );
  });

  it("still scopes to the location", async () => {
    await resolveLocationAssetIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=laptop",
    });

    expect(dbMock.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetLocations: { some: { locationId: LOC } },
        }),
      })
    );
  });

  it("does not fall back to a request URL for filters", async () => {
    // The old shape took `request` and read `request.url`. Passing one now must
    // not resurrect that path — an unfiltered select-all is the data-loss case.
    await resolveLocationAssetIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=laptop",
      // @ts-expect-error — deliberately passing the removed parameter
      request: new Request("http://localhost/locations/loc-1/assets?s=ignored"),
    });

    expect(getAssetsWhereInput).toHaveBeenCalledWith(
      expect.objectContaining({ currentSearchParams: "s=laptop" })
    );
  });
});

describe("resolveLocationKitIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.kit.findMany.mockResolvedValue([{ id: "k1" }]);
  });

  it("returns explicit ids untouched", async () => {
    const ids = await resolveLocationKitIds({
      ids: ["k1"],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=case",
    });

    expect(ids).toEqual(["k1"]);
    expect(dbMock.kit.findMany).not.toHaveBeenCalled();
  });

  it("passes the submitted filters through on select all", async () => {
    await resolveLocationKitIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=case",
    });

    expect(getKitsWhereInput).toHaveBeenCalledWith(
      expect.objectContaining({ currentSearchParams: "s=case" })
    );
  });

  it("still scopes to the location", async () => {
    await resolveLocationKitIds({
      ids: [ALL_SELECTED_KEY],
      organizationId: ORG,
      locationId: LOC,
      currentSearchParams: "s=case",
    });

    expect(dbMock.kit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ locationId: LOC }),
      })
    );
  });
});
