import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { AssetsFromViewItem } from "~/modules/asset/types";
import { AssetsList } from "./assets-list";

const mockUseLoaderData = vi.fn();
const mockUseAssetIndexViewState = vi.fn(() => ({ modeIsSimple: true }));
const listItemTagsColumnSpy = vi.fn();

// why: provide loader data and noop fetchers used by AssetsList
vi.mock("@remix-run/react", async () => {
  const actual = (await vi.importActual("@remix-run/react")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    useLoaderData: () => mockUseLoaderData(),
    useFetchers: () => [],
    useFetcher: () => ({
      Form: ({ children, ...rest }: any) => <form {...rest}>{children}</form>,
    }),
  };
});

// why: avoid motion animation requirements in tests
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

// why: lucide icons rely on DOM APIs not needed in this test
vi.mock("lucide-react", async () => {
  const actual = (await vi.importActual("lucide-react")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    Package: () => <span data-testid="package-icon" />,
    CopyIcon: () => <span data-testid="copy-icon" />,
    PencilIcon: () => <span data-testid="pencil-icon" />,
    QrCodeIcon: () => <span data-testid="qrcode-icon" />,
    Trash2Icon: () => <span data-testid="trash-icon" />,
    Info: () => <span data-testid="info-icon" />,
  };
});

// why: components pull in lottie which expects a canvas-enabled DOM
vi.mock("lottie-web", () => ({
  loadAnimation: vi.fn(),
}));

// why: ensure animations do not execute in test environment
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: () => <div data-testid="lottie" />,
}));

// why: render loader items without the full List implementation
vi.mock("~/components/list", () => ({
  List: ({ ItemComponent, bulkActions }: any) => {
    const { items } = mockUseLoaderData();

    return (
      <table data-testid="list">
        <tbody>
          {items.map((item: AssetsFromViewItem) => (
            <tr key={item.id}>
              <ItemComponent
                item={item}
                bulkActions={bulkActions}
                isUserPage={false}
              />
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
}));

// why: ListAssetContent wraps content in ListContentWrapper for layout only
vi.mock("~/components/list/content-wrapper", () => ({
  ListContentWrapper: ({ children }: { children: ReactNode }) => (
    <div data-testid="list-content-wrapper">{children}</div>
  ),
}));

// why: simplify button/link rendering
vi.mock("~/components/shared/button", () => ({
  Button: ({ children, ...rest }: any) => (
    <button {...rest} type="button">
      {children}
    </button>
  ),
}));

// why: avoid tooltip implementation complexity
vi.mock("~/components/shared/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// why: present simple text wrappers for table cells
vi.mock("~/components/table", () => ({
  Th: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  Td: ({ children }: { children: ReactNode }) => <td>{children}</td>,
}));

// why: When component just evaluates truthiness in tests
vi.mock("~/components/when/when", () => ({
  default: ({ truthy, children }: { truthy: boolean; children: ReactNode }) => (
    <>{truthy ? children : null}</>
  ),
}));

// why: avoid styled badge implementations
vi.mock("~/components/shared/gray-badge", () => ({
  GrayBadge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

// why: avoid tooltip content dependency
vi.mock("~/components/shared/info-tooltip", () => ({
  InfoTooltip: () => <div data-testid="info-tooltip" />,
}));

// why: spinner visuals not required
vi.mock("~/components/shared/spinner", () => ({
  Spinner: () => <div data-testid="spinner" />,
}));

// why: simplify team member badge rendering
vi.mock("~/components/user/team-member-badge", () => ({
  TeamMemberBadge: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// why: ensure no-op for disabled hook
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

// why: keep asset index columns deterministic in tests
vi.mock("~/hooks/use-asset-index-columns", () => ({
  useAssetIndexColumns: () => [],
}));

// why: control simple/advanced mode in tests
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => mockUseAssetIndexViewState(),
}));

// why: force desktop viewport in tests
vi.mock("~/hooks/use-viewport-height", () => ({
  useViewportHeight: () => ({ isMd: true }),
}));

// why: disable availability view branch
vi.mock("~/hooks/use-is-availability-view", () => ({
  useIsAvailabilityView: () => ({
    isAvailabilityView: false,
    shouldShowAvailabilityView: false,
  }),
}));

// why: render behavior for list item tags is under test
vi.mock("./list-item-tags-column", () => ({
  ListItemTagsColumn: (props: any) => {
    listItemTagsColumnSpy(props);
    return <div data-testid="list-item-tags-column" />;
  },
}));

// why: simplify asset image component
vi.mock("../asset-image", () => ({
  AssetImage: () => <div data-testid="asset-image" />,
}));

// why: avoid full status badge implementation
vi.mock("../asset-status-badge", () => ({
  AssetStatusBadge: () => <div data-testid="asset-status-badge" />,
}));

// why: avoid category badge styling
vi.mock("../category-badge", () => ({
  CategoryBadge: () => <div data-testid="category-badge" />,
}));

// why: quick actions not relevant for this assertion
vi.mock("./asset-quick-actions", () => ({
  default: () => <div data-testid="asset-quick-actions" />,
}));

// why: pagination and filters are irrelevant for this test
vi.mock("./asset-index-pagination", () => ({
  AssetIndexPagination: () => <div data-testid="pagination" />,
}));
vi.mock("./filters", () => ({
  AssetIndexFilters: () => <div data-testid="filters" />,
}));

// why: advanced mode components unused in simple mode but must exist
vi.mock("./advanced-asset-row", () => ({
  AdvancedAssetRow: () => <div data-testid="advanced-asset-row" />,
}));
vi.mock("./advanced-table-header", () => ({
  AdvancedTableHeader: () => <div data-testid="advanced-table-header" />,
}));

// why: disable availability calendar branch
vi.mock("../../availability-calendar/availability-calendar", () => ({
  default: () => <div data-testid="availability-calendar" />,
}));

// why: provide deterministic availability data
vi.mock("./use-asset-availability-data", () => ({
  useAssetAvailabilityData: () => ({ resources: [], events: [] }),
}));

// why: ensure user role helper doesn't hide bulk actions
vi.mock("~/hooks/user-user-role-helper", () => ({
  useUserRoleHelper: () => ({ isBase: false }),
}));

// why: treat test as non-user asset page
vi.mock("~/hooks/use-is-user-assets-page", () => ({
  useIsUserAssetsPage: () => false,
}));

describe("AssetsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAssetIndexViewState.mockReturnValue({ modeIsSimple: true });
  });

  it("passes tags to the ListItemTagsColumn in simple mode", () => {
    const tags = [
      { id: "tag-1", name: "Tag 1" },
      { id: "tag-2", name: "Tag 2" },
    ];

    const asset = {
      id: "asset-1",
      title: "Asset One",
      status: "AVAILABLE",
      availableToBook: true,
      mainImage: null,
      thumbnailImage: null,
      mainImageExpiration: null,
      category: { id: "category-1", name: "Category" },
      tags,
      custody: null,
      location: null,
      kit: null,
      qrCodes: [],
    } as unknown as AssetsFromViewItem;

    mockUseLoaderData.mockReturnValue({
      items: [asset],
    });

    render(<AssetsList disableBulkActions />);

    expect(listItemTagsColumnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tags })
    );
  });
});
