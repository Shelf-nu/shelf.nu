/**
 * Tests for {@link buildAssetsByStatusChart}: the legend links each status to
 * the asset index filtered by it, so every entry must carry the raw
 * `AssetStatus` beside its friendly label.
 *
 * @see {@link file://./dashboard.server.ts}
 * @see {@link file://./../components/dashboard/assets-by-status-chart.tsx}
 */
import { describe, expect, it, vi } from "vitest";

// why: imported by the module under test; nothing here may reach the database.
vi.mock("~/database/db.server", () => ({ db: {} }));

import { buildAssetsByStatusChart } from "./dashboard.server";

describe("buildAssetsByStatusChart", () => {
  it("keeps the raw status for the filter link beside the friendly label", () => {
    const { chartData } = buildAssetsByStatusChart([
      { status: "IN_CUSTODY", _count: { _all: 3 } },
    ]);

    expect(chartData).toEqual([
      expect.objectContaining({
        id: "IN_CUSTODY",
        assets: 3,
      }),
    ]);
  });
});
