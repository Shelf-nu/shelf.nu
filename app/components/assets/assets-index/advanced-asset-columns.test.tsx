import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AdvancedIndexAsset } from "~/modules/asset/types";

import { AdvancedIndexColumn } from "./advanced-asset-columns";

const dateSpy = vi.fn();

// why: capture includeTime flag without rendering the full formatter
vi.mock("~/components/shared/date", () => ({
  DateS: (props: any) => {
    dateSpy(props);
    return <span data-testid="date" />;
  },
}));

// why: prevent lottie-web from initializing canvas contexts during import
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: () => null,
}));

// why: avoid heavy dialog logic and network hooks unrelated to this test
vi.mock("~/components/code-preview/code-preview-dialog", () => ({
  CodePreviewDialog: () => null,
}));

// why: simplify asset image rendering that depends on Remix fetchers
vi.mock("~/components/assets/asset-image/component", () => ({
  AssetImage: () => null,
}));

// why: skip quick actions which depend on permission hooks
vi.mock("./asset-quick-actions", () => ({
  __esModule: true,
  default: () => null,
}));

// why: category badge imports context we don't need for date rendering
vi.mock("../category-badge", () => ({
  CategoryBadge: () => null,
}));

// why: component reads loader data for locale and organization context
vi.mock("@remix-run/react", async () => {
  const actual = await vi.importActual("@remix-run/react");

  return {
    ...(actual as Record<string, unknown>),
    useLoaderData: () => ({
      locale: "en-US",
      timeZone: "UTC",
      currentOrganization: { currency: "USD" },
    }),
  };
});

// why: avoid toggling asset images during isolated column tests
vi.mock("~/hooks/use-asset-index-show-image", () => ({
  useAssetIndexShowImage: () => false,
}));

// why: bypass freeze column logic which relies on external context
vi.mock("~/hooks/use-asset-index-freeze-column", () => ({
  useAssetIndexFreezeColumn: () => false,
}));

// why: keep advanced view flag stable without touching application state
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({ modeIsAdvanced: true }),
}));

describe("AdvancedIndexColumn date handling", () => {
  const baseAsset: AdvancedIndexAsset = {
    id: "asset-1",
    sequentialId: "AS-001",
    title: "Tripod",
    description: "",
    createdAt: new Date("2024-01-01T12:00:00.000Z"),
    updatedAt: new Date("2024-01-05T15:30:00.000Z"),
    userId: "user-1",
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    categoryId: null,
    locationId: null,
    organizationId: "org-1",
    status: "AVAILABLE",
    valuation: null,
    availableToBook: true,
    kitId: null,
    qrId: "QR-1",
    kit: null,
    category: null,
    tags: [],
    location: null,
    custody: null,
    customFields: [],
    upcomingReminder: undefined,
    bookings: undefined,
    barcodes: [],
  };

  beforeEach(() => {
    dateSpy.mockClear();
  });

  it("keeps createdAt formatted without time", () => {
    render(<AdvancedIndexColumn column="createdAt" item={baseAsset} />);

    expect(dateSpy).toHaveBeenCalledTimes(1);
    expect(dateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ includeTime: false, date: baseAsset.createdAt })
    );
  });

  it("enables time for the updatedAt column", () => {
    render(<AdvancedIndexColumn column="updatedAt" item={baseAsset} />);

    expect(dateSpy).toHaveBeenCalledTimes(1);
    expect(dateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ includeTime: true, date: baseAsset.updatedAt })
    );
  });
});
