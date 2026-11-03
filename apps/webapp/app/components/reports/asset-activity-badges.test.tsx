/**
 * Asset Activity report body: activity type badges.
 *
 * Each activity type reads as a word on its badge, never as the code the
 * report row carries ("ARCHIVED").
 *
 * @see {@link file://./asset-activity-content.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { AssetActivityRow } from "~/modules/reports/types";

import { AssetActivityContent } from "./asset-activity-content";

// why: the Date & Time cell formats through this hook, which reads the root
// route loader; there is no router in a unit test, and dates are not what
// this case is about.
vi.mock("~/hooks/use-date-formatter", () => ({
  useDateFormatter: () => ({
    formatDate: () => "15/10/2026",
    formatTime: () => "10:00",
    formatDateTime: () => "15/10/2026, 10:00",
  }),
}));

/** One report row of the given activity type. */
function row(activityType: AssetActivityRow["activityType"]) {
  return {
    id: `evt-${activityType}`,
    assetId: "asset-1",
    assetName: "Pallet 17",
    thumbnailImage: null,
    mainImage: null,
    assetModel: null,
    activityType,
    // Neutral text, so only the badge can show the type.
    description: "Changed",
    occurredAt: new Date("2026-10-15T10:00:00Z"),
    performedBy: "Sam Mover",
    context: null,
  } as AssetActivityRow;
}

describe("AssetActivityContent activity badges", () => {
  it("labels archive and reinstate rows in words", () => {
    render(
      <AssetActivityContent
        rows={[row("ARCHIVED"), row("REINSTATED")]}
        kpis={[]}
        totalRows={2}
      />
    );

    // The legend names the pair once; each row's badge names its own type.
    expect(screen.getByText("Archived / Reinstated")).toBeInTheDocument();
    expect(screen.getByText("Archived")).toBeInTheDocument();
    expect(screen.getByText("Reinstated")).toBeInTheDocument();
    expect(screen.queryByText("ARCHIVED")).toBeNull();
  });
});
