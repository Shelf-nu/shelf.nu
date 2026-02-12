import type { LoaderFunctionArgs } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { locationDescendantsMock } from "@mocks/location-descendants";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { getAsset } from "~/modules/asset/service.server";
import { getAssetDepreciation } from "~/modules/asset-depreciation/service.server";

// why: mocking location descendants to avoid database queries during tests
vi.mock("~/modules/location/descendants.server", () => locationDescendantsMock);

// why: we only want to verify loader behavior, not permission internals
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: isolate route behavior from database/service implementation details
vi.mock("~/modules/asset/service.server", () => ({
  getAsset: vi.fn(),
}));

// why: isolate route behavior from database/service implementation details
vi.mock("~/modules/asset-depreciation/service.server", () => ({
  getAssetDepreciation: vi.fn(),
}));

// why: suppress lottie animation initialization during route import
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

// why: route only needs CSV value formatting; mock avoids importing heavy CSV module graph in tests
vi.mock("~/utils/csv.server", () => ({
  formatValueForCsv: (value: unknown) => {
    if (value === null || value === undefined || value === "") return '""';
    return `"${String(value).replace(/"/g, '""')}"`;
  },
}));

let loader: (typeof import("~/routes/_layout+/assets.$assetId.depreciation-export[.csv]"))["loader"];
const requirePermissionMock = vi.mocked(requirePermission);
const getAssetMock = vi.mocked(getAsset);
const getAssetDepreciationMock = vi.mocked(getAssetDepreciation);

beforeAll(async () => {
  ({ loader } = await import(
    "~/routes/_layout+/assets.$assetId.depreciation-export[.csv]"
  ));
});

describe("app/routes/_layout+/assets.$assetId.depreciation-export[.csv] loader", () => {
  const context = {
    getSession: () => ({ userId: "user-123" }),
  } as LoaderFunctionArgs["context"];

  beforeEach(() => {
    vi.clearAllMocks();

    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [],
      currentOrganization: {
        id: "org-1",
        currency: "USD",
      },
    } as any);

    getAssetMock.mockResolvedValue({
      id: "asset-123",
      title: "Camera A",
      sequentialId: "A-0001",
      valuation: 1200,
      disposedAt: null,
    } as any);

    getAssetDepreciationMock.mockResolvedValue({
      assetId: "asset-123",
      depreciationRate: 20,
      period: "MONTHLY",
      residualValue: 0,
      startDate: new Date("2025-01-15"),
    } as any);
  });

  it("returns a downloadable CSV with depreciation schedule rows", async () => {
    const response = await loader(
      createLoaderArgs({
        context,
        request: new Request(
          "https://example.com/assets/asset-123/depreciation-export.csv"
        ),
        params: { assetId: "asset-123" },
      })
    );

    expect(requirePermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-123",
        request: expect.any(Request),
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      })
    );

    expect(response instanceof Response).toBe(true);
    expect((response as Response).status).toBe(200);
    expect((response as Response).headers.get("content-type")).toBe("text/csv");
    expect((response as Response).headers.get("content-disposition")).toContain(
      "Camera A-depreciation"
    );

    const csv = await (response as Response).text();
    const rows = csv.trim().split("\n");

    expect(rows[0]).toContain('"Asset ID";"Asset Name";"Sequential ID"');
    expect(rows[0]).toContain('"Depreciation Rate";"Period"');
    expect(rows[1]).toContain('"asset-123"');
    expect(rows[1]).toContain('"Camera A"');
    expect(rows.length).toBeGreaterThan(1);
  });

  it("returns 204 with attachment headers when depreciation settings are missing", async () => {
    getAssetDepreciationMock.mockResolvedValue(null);

    const response = await loader(
      createLoaderArgs({
        context,
        request: new Request(
          "https://example.com/assets/asset-123/depreciation-export.csv"
        ),
        params: { assetId: "asset-123" },
      })
    );

    expect(response instanceof Response).toBe(true);
    expect((response as Response).status).toBe(204);
    expect((response as Response).headers.get("content-type")).toBe("text/csv");
    expect((response as Response).headers.get("content-disposition")).toContain(
      "Camera A-depreciation"
    );
    expect(await (response as Response).text()).toBe("");
  });
});
