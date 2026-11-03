/**
 * Asset Activity Summary: archive and reinstate rows.
 *
 * An asset taken out of service, or brought back, is part of its history, so
 * the report lists those events as "Archived" and "Reinstated" rows.
 *
 * @see {@link file://./helpers.server.ts} `assetActivityReport`
 */

import type { ActivityAction } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the report reads Prisma; these cases hand it events in memory and
// assert on the rows it builds and the actions it asks for.
vi.mock("~/database/db.server", () => ({
  db: {
    activityEvent: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    asset: { findMany: vi.fn(), findFirst: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import { db } from "~/database/db.server";

import { assetActivityReport } from "./helpers.server";
import type { ResolvedTimeframe } from "./types";

const ORG = "org-1";

const TIMEFRAME: ResolvedTimeframe = {
  preset: "last_30d",
  label: "Last 30 days",
  from: new Date("2026-10-01T00:00:00Z"),
  to: new Date("2026-10-31T23:59:59Z"),
};

/** An ActivityEvent row as `db.activityEvent.findMany` returns it. */
function event(id: string, action: ActivityAction) {
  return {
    id,
    organizationId: ORG,
    occurredAt: new Date("2026-10-15T10:00:00Z"),
    action,
    assetId: "asset-1",
    actorSnapshot: { firstName: "Sam", lastName: "Mover", displayName: null },
    field: null,
    fromValue: null,
    toValue: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.activityEvent.count).mockResolvedValue(2);
  vi.mocked(db.activityEvent.groupBy).mockResolvedValue([] as never);
  vi.mocked(db.asset.findMany).mockResolvedValue([
    {
      id: "asset-1",
      organizationId: ORG,
      title: "Pallet 17",
      sequentialId: null,
      qrCodes: [],
      mainImage: null,
      mainImageExpiration: null,
      thumbnailImage: null,
      assetModel: null,
    },
  ] as never);
});

describe("assetActivityReport archive rows", () => {
  it("lists archive and reinstate events as their own rows", async () => {
    vi.mocked(db.activityEvent.findMany).mockResolvedValue([
      event("evt-2", "ASSET_UNARCHIVED"),
      event("evt-1", "ASSET_ARCHIVED"),
    ] as never);

    const { rows } = await assetActivityReport({
      organizationId: ORG,
      timeframe: TIMEFRAME,
    });

    expect(
      rows.map(({ assetName, activityType, description }) => ({
        assetName,
        activityType,
        description,
      }))
    ).toEqual([
      {
        assetName: "Pallet 17",
        activityType: "REINSTATED",
        description: "Reinstated",
      },
      {
        assetName: "Pallet 17",
        activityType: "ARCHIVED",
        description: "Archived",
      },
    ]);

    const [query] = vi.mocked(db.activityEvent.findMany).mock.calls[0];
    expect(query?.where?.action).toEqual({
      in: expect.arrayContaining(["ASSET_ARCHIVED", "ASSET_UNARCHIVED"]),
    });
  });
});
