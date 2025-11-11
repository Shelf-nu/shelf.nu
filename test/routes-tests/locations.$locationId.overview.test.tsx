import type { Currency } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  getLocation,
  getLocationTotalValuation,
} from "~/modules/location/service.server";
import { getClientHint } from "~/utils/client-hints";
import { formatCurrency } from "~/utils/currency";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import LocationOverview, {
  loader,
} from "~/routes/_layout+/locations.$locationId.overview";

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/modules/location/service.server", () => ({
  getLocation: vi.fn(),
  getLocationTotalValuation: vi.fn(),
}));

const mockDateFormatter = vi.fn(() => "formatted-date");

vi.mock("~/utils/client-hints", () => ({
  getClientHint: vi.fn(() => ({ locale: "en-GB", timeZone: "UTC" })),
  getDateTimeFormat: vi.fn(() => ({ format: mockDateFormatter })),
  getDateTimeFormatFromHints: vi.fn(() => ({ format: mockDateFormatter })),
  useHints: vi.fn(() => ({ locale: "en-GB", timeZone: "UTC" })),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("@remix-run/react");

  return {
    ...(actual as Record<string, unknown>),
    useLoaderData: vi.fn(),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);
const getLocationMock = vi.mocked(getLocation);
const getLocationTotalValuationMock = vi.mocked(getLocationTotalValuation);
const getClientHintMock = vi.mocked(getClientHint);
const useLoaderDataMock = vi.mocked(useLoaderData);

function createLoaderArgs(
  overrides: Partial<LoaderFunctionArgs> = {}
): LoaderFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    params: { locationId: "loc-123" },
    request: new Request("https://example.com/locations/loc-123/overview"),
    ...overrides,
  } as LoaderFunctionArgs;
}

describe("locations.$locationId.overview loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns formatted location data with total valuation", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
      userOrganizations: [],
      currentOrganization: {
        id: "org-1",
        name: "Test Organization",
        currency: "USD" as Currency,
      },
    } as any);

    getLocationMock.mockResolvedValue({
      location: {
        id: "loc-123",
        name: "Main Warehouse",
        createdAt: new Date("2024-01-01T12:34:56Z"),
      },
    } as any);

    getLocationTotalValuationMock.mockResolvedValue(9876.54);

    const args = createLoaderArgs({
      request: new Request("https://example.com", {
        headers: {
          "accept-language": "en-GB",
          cookie: "CH-time-zone=UTC",
        },
      }),
    });

    const result = await loader(args);

    expect(requirePermissionMock).toHaveBeenCalledWith({
      userId: "user-123",
      request: args.request,
      entity: PermissionEntity.location,
      action: PermissionAction.read,
    });

    expect(getLocationMock).toHaveBeenCalledWith({
      id: "loc-123",
      organizationId: "org-1",
      request: args.request,
      userOrganizations: [],
    });
    expect(getLocationTotalValuationMock).toHaveBeenCalledWith({
      locationId: "loc-123",
    });

    expect(getClientHintMock).toHaveBeenCalledWith(args.request);

    expect(result).toEqual(
      expect.objectContaining({
        error: null,
        location: expect.objectContaining({
          id: "loc-123",
          // In tests, Date stays as Date object (will be serialized on network)
          createdAt: new Date("2024-01-01T12:34:56Z"),
        }),
        totalValue: 9876.54,
        locale: "en-GB",
        currentOrganization: expect.objectContaining({ currency: "USD" }),
      })
    );
  });
});

describe("LocationOverview component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the overview card with formatted values", () => {
    useLoaderDataMock.mockReturnValue({
      location: {
        id: "loc-123",
        createdAt: new Date("2024-01-01T12:34:56Z"),
      },
      totalValue: 12345.6,
      currentOrganization: { currency: "USD" as Currency },
      locale: "en-US",
    });

    render(<LocationOverview />);

    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("loc-123")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    // DateS component formats the date client-side
    expect(screen.getByText("formatted-date")).toBeInTheDocument();

    const formattedValue = formatCurrency({
      value: 12345.6,
      currency: "USD" as Currency,
      locale: "en-US",
    });
    expect(screen.getByText(formattedValue)).toBeInTheDocument();
  });
});
