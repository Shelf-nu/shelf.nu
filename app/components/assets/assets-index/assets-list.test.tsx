import { OrganizationRoles } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdvancedIndexAsset,
  AssetsFromViewItem,
} from "~/modules/asset/types";
import { AdvancedIndexColumn } from "./advanced-asset-columns";
import { ListAssetContent, ListItemTagsColumn } from "./assets-list";

// why: component reads loader data and renders Remix Link elements
vi.mock("@remix-run/react", async () => {
  const actual = await vi.importActual("@remix-run/react");

  return {
    ...(actual as Record<string, unknown>),
    useLoaderData: vi.fn(),
    Link: ({ children, to, ...props }: any) => (
      <a href={typeof to === "string" && to ? to : "/"} {...props}>
        {children}
      </a>
    ),
  };
});

// why: AssetImage triggers Remix fetchers and dialogs not needed for this render
vi.mock("../asset-image", () => ({
  AssetImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

// why: AssetStatusBadge fetches booking data we do not exercise here
vi.mock("../asset-status-badge", () => ({
  AssetStatusBadge: () => <div>status</div>,
}));

// why: AssetQuickActions relies on permission hooks and dialogs
vi.mock("./asset-quick-actions", () => ({
  __esModule: true,
  default: () => <div>quick actions</div>,
}));

// why: AvailabilityCalendar pulls in FullCalendar which expects browser APIs
vi.mock("../../availability-calendar/availability-calendar", () => ({
  __esModule: true,
  default: () => <div>availability calendar</div>,
}));

// why: upstream components import lottie-react which depends on DOM canvas APIs
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: () => null,
}));

// why: shared Button depends on Remix Link and tooltip portals
vi.mock("~/components/shared/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

// why: TeamMemberBadge pulls organization context
vi.mock("~/components/user/team-member-badge", () => ({
  TeamMemberBadge: ({ teamMember }: { teamMember: unknown }) =>
    teamMember ? <span>team member</span> : null,
}));

// why: AdvancedIndexColumn reads freeze column configuration
vi.mock("~/hooks/use-asset-index-freeze-column", () => ({
  useAssetIndexFreezeColumn: () => null,
}));

// why: AdvancedIndexColumn toggles image visibility by hook
vi.mock("~/hooks/use-asset-index-show-image", () => ({
  useAssetIndexShowImage: () => false,
}));

// why: components branch on simple vs advanced view mode
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({
    modeIsAdvanced: true,
    modeIsSimple: false,
  }),
}));

// why: custody column checks permissions derived from user roles
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({
    roles: [OrganizationRoles.ADMIN],
    isBase: false,
  }),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);

function createSimpleItem(
  overrides: Partial<AssetsFromViewItem> = {}
): AssetsFromViewItem {
  return {
    id: "asset-1",
    title: "Camera",
    status: "AVAILABLE" as any,
    availableToBook: true,
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    category: { id: "cat-1", name: "Cameras", color: "#fff" } as any,
    tags: [],
    custody: null,
    location: null,
    kit: null,
    qrCodes: [],
    ...overrides,
  } as AssetsFromViewItem;
}

function createAdvancedItem(
  overrides: Partial<AdvancedIndexAsset> = {}
): AdvancedIndexAsset {
  return {
    id: "asset-1",
    sequentialId: "1",
    title: "Camera",
    description: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    userId: "user-1",
    mainImage: null,
    thumbnailImage: null,
    mainImageExpiration: null,
    categoryId: "cat-1",
    locationId: null,
    organizationId: "org-1",
    status: "AVAILABLE" as any,
    valuation: null,
    availableToBook: true,
    kitId: null,
    qrId: "qr-1",
    kit: null,
    category: null,
    tags: [],
    location: null,
    custody: { custodian: null } as any,
    customFields: [],
    upcomingReminder: undefined,
    bookings: [],
    barcodes: [],
    ...overrides,
  } as AdvancedIndexAsset;
}

describe("asset index empty values", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLoaderDataMock.mockReturnValue({
      locale: "en-US",
      currentOrganization: { currency: "USD" },
      timeZone: "UTC",
    });
  });

  it("renders placeholders in the simple asset list when optional data is missing", () => {
    const item = createSimpleItem();

    render(
      <table>
        <tbody>
          <tr>
            <ListAssetContent item={item} isUserPage={false} />
          </tr>
        </tbody>
      </table>
    );

    const placeholders = screen.getAllByLabelText("No data");
    expect(placeholders).toHaveLength(3);
    placeholders.forEach((placeholder) => {
      expect(placeholder).toHaveTextContent("—");
    });
  });

  it("renders placeholders in advanced columns when optional data is missing", () => {
    const item = createAdvancedItem();

    render(
      <table>
        <tbody>
          <tr>
            <AdvancedIndexColumn column="tags" item={item} />
            <AdvancedIndexColumn column="custody" item={item} />
            <AdvancedIndexColumn column="location" item={item} />
            <AdvancedIndexColumn column="kit" item={item} />
          </tr>
        </tbody>
      </table>
    );

    const placeholders = screen.getAllByLabelText("No data");
    expect(placeholders).toHaveLength(4);
    placeholders.forEach((placeholder) => {
      expect(placeholder).toHaveTextContent("—");
    });
  });

  it("shows placeholder for the tags column helper when no tags exist", () => {
    render(<ListItemTagsColumn tags={[]} />);

    const placeholder = screen.getByLabelText("No data");
    expect(placeholder).toHaveTextContent("—");
  });
});
