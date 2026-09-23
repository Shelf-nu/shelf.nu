/**
 * Bulk release custody: the SELF_SERVICE ownership guard.
 *
 * A self-service user may only release custody they hold themselves, so the
 * route refuses the whole request if any of the selected assets is in someone
 * else's custody. The set it judges has to be the set the release will actually
 * touch: `bulkCheckInAssets` skips QUANTITY_TRACKED assets (they are released
 * per-quantity, individually) and reports how many it skipped, so custody on
 * one of those is not the caller's to be refused over.
 *
 * @see {@link file://./../../../app/routes/api+/assets.bulk-release-custody.ts}
 */
import { AssetType } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { bulkCheckInAssets } from "~/modules/asset/service.server";
import * as rolesServer from "~/utils/roles.server";

import { action } from "~/routes/api+/assets.bulk-release-custody";

// @vitest-environment node

// why: the only database read in the route is the custody lookup, faked below
// so the `where` clause it builds actually decides the outcome.
vi.mock("~/database/db.server", () => ({
  db: { custody: { findMany: vi.fn() } },
}));

// why: the permission check reads the session cookie and the database; the role
// it resolves is an input these cases set directly.
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the write under guard. Its `skippedQuantityTracked` count is what makes
// judging quantity-tracked custody here wrong in the first place.
vi.mock("~/modules/asset/service.server", () => ({
  bulkCheckInAssets: vi.fn(),
}));

// why: reads the caller's column preferences from the database; the release
// path passes them straight through.
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: narrows a "select all" custodian filter via a database read; these cases
// submit explicit asset ids.
vi.mock("~/modules/team-member/service.server", () => ({
  scopeCustodianFilterIds: vi.fn().mockResolvedValue([]),
}));

// why: reads the acting user's date preferences from the database.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
}));

// why: pushes to a server-sent-events emitter with no test transport.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/**
 * The org's custody rows. The caller holds the individual asset; a colleague
 * holds units of the quantity-tracked one.
 */
const CUSTODY_ROWS = [
  {
    assetId: "asset-individual",
    type: AssetType.INDIVIDUAL,
    custodian: { id: "tm-self", userId: "user-self" },
  },
  {
    assetId: "asset-qt",
    type: AssetType.QUANTITY_TRACKED,
    custodian: { id: "tm-colleague", userId: "user-colleague" },
  },
];

/**
 * Stands in for `db.custody.findMany`, honouring the `assetId` and asset `type`
 * predicates the route builds — so a guard that looks at the wrong rows fails
 * here rather than passing on a fixture that was never filtered.
 */
function fakeFindMany(args: {
  where: {
    assetId: { in: string[] };
    asset: { type?: { not?: AssetType } };
  };
}) {
  const excludedType = args.where.asset?.type?.not;
  return Promise.resolve(
    CUSTODY_ROWS.filter(
      (row) =>
        args.where.assetId.in.includes(row.assetId) && row.type !== excludedType
    ).map((row) => ({ custodian: row.custodian }))
  );
}

async function submit(assetIds: string[]) {
  const body = new URLSearchParams();
  assetIds.forEach((id) => body.append("assetIds[]", id));

  const response = await action(
    createActionArgs({
      request: new Request("http://localhost/api/assets/bulk-release-custody", {
        method: "POST",
        body,
      }),
      context: { getSession: () => ({ userId: "user-self" }) } as never,
    })
  );

  assertIsDataWithResponseInit(response);
  return response;
}

describe("bulk release custody as SELF_SERVICE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rolesServer.requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canSeeAllCustody: false,
    } as never);
    vi.mocked(bulkCheckInAssets).mockResolvedValue({
      skippedQuantityTracked: 1,
    } as never);
    vi.mocked(db.custody.findMany).mockImplementation(fakeFindMany as never);
  });

  it("releases its own asset even when the selection also holds a colleague's quantity-tracked custody", async () => {
    const response = await submit(["asset-individual", "asset-qt"]);

    expect(response.init?.status ?? 200).toBe(200);
    expect(response.data).toMatchObject({ success: true });
    expect(bulkCheckInAssets).toHaveBeenCalledOnce();
  });

  it("does not judge quantity-tracked custody, which the release skips", async () => {
    await submit(["asset-individual", "asset-qt"]);

    expect(db.custody.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          asset: expect.objectContaining({
            type: { not: AssetType.QUANTITY_TRACKED },
          }),
        }),
      })
    );
  });

  it("still refuses a selection holding an individual asset in someone else's custody", async () => {
    vi.mocked(db.custody.findMany).mockResolvedValue([
      { custodian: { id: "tm-colleague", userId: "user-colleague" } },
    ] as never);

    const response = await submit(["asset-other"]);

    expect(response.init?.status).toBe(403);
    expect(bulkCheckInAssets).not.toHaveBeenCalled();
  });
});
