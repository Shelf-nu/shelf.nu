import type { ReactNode } from "react";
import { useLoaderData } from "@remix-run/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdvancedIndexAsset,
  AssetsFromViewItem,
} from "~/modules/asset/types";
import { AdvancedIndexColumn } from "./advanced-asset-columns";
import { ListAssetContent, ListItemTagsColumn } from "./assets-list";

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

vi.mock("../asset-image", () => ({
  AssetImage: ({ alt }: { alt: string }) => <div>{alt}</div>,
}));

vi.mock("../asset-status-badge", () => ({
  AssetStatusBadge: () => <div>status</div>,
}));

vi.mock("../category-badge", () => ({
  CategoryBadge: ({ category }: { category: { name: string } | null }) => (
    <div>{category?.name ?? ""}</div>
  ),
}));

vi.mock("../bulk-actions-dropdown", () => ({
  __esModule: true,
  default: () => <div>bulk actions</div>,
}));

vi.mock("./asset-quick-actions", () => ({
  __esModule: true,
  default: () => <div>quick actions</div>,
}));

vi.mock("~/components/shared/button", () => ({
  Button: ({ children, ...props }: any) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock("~/components/shared/gray-badge", () => ({
  GrayBadge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("~/components/shared/tag", () => ({
  Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("~/components/user/team-member-badge", () => ({
  TeamMemberBadge: ({ teamMember }: { teamMember: unknown }) =>
    teamMember ? <span>team member</span> : null,
}));

vi.mock("~/hooks/use-asset-index-freeze-column", () => ({
  useAssetIndexFreezeColumn: () => null,
}));

vi.mock("~/hooks/use-asset-index-show-image", () => ({
  useAssetIndexShowImage: () => false,
}));

vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({
    modeIsAdvanced: true,
    modeIsSimple: false,
  }),
}));

vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => ({ currency: "USD" }),
}));

vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({ roles: [] }),
}));

vi.mock("~/utils/permissions/permission.validator.client", () => ({
  userHasPermission: () => true,
}));

vi.mock(
  "~/utils/permissions/custody-and-bookings-permissions.validator.client",
  () => ({
    userHasCustodyViewPermission: () => true,
  })
);

vi.mock("~/components/calendar/event-card", () => ({
  EventCardContent: () => <div>event</div>,
}));

vi.mock("~/components/markdown/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: ReactNode }) => <div>{content}</div>,
}));

vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: Date | string }) => <time>{String(date)}</time>,
}));

vi.mock("~/components/shared/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/shared/hover-card", () => ({
  HoverCard: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  HoverCardContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@radix-ui/react-hover-card", () => ({
  HoverCardPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@radix-ui/react-popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("~/components/code-preview/code-preview-dialog", () => ({
  CodePreviewDialog: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}));

vi.mock("~/components/shared/info-tooltip", () => ({
  InfoTooltip: () => <div>info</div>,
}));

vi.mock("~/components/shared/spinner", () => ({
  Spinner: () => <div>spinner</div>,
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
