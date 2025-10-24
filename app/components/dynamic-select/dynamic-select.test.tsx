import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelFilterItem } from "~/hooks/use-model-filters";
import DynamicSelect from "./dynamic-select";

// why: controlling navigation state to test component without triggering actual Remix navigation
vi.mock("@remix-run/react", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await vi.importActual("@remix-run/react");
  return {
    ...actual,
    useNavigation: vi.fn(() => ({ state: "idle" })),
  };
});

// why: controlling filter data and behavior to test DynamicSelect in isolation
const mockUseModelFilters = vi.fn();
vi.mock("~/hooks/use-model-filters", () => ({
  useModelFilters: (...args: any[]) => mockUseModelFilters(...args),
}));

/**
 * Helper to create test items with realistic structure
 */
function createTestItems(count: number): ModelFilterItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i + 1}`,
    name: `Item ${i + 1}`,
    metadata: {},
  }));
}

/**
 * Helper to create a complete mock return value for useModelFilters
 */
function createMockUseModelFiltersReturn(
  items: ModelFilterItem[] = createTestItems(3),
  overrides: Partial<ReturnType<typeof mockUseModelFilters>> = {}
) {
  return {
    searchQuery: "",
    setSearchQuery: vi.fn(),
    handleSearchQueryChange: vi.fn((e: React.ChangeEvent<HTMLInputElement>) => {
      // Update searchQuery in subsequent calls
      mockUseModelFilters.mockReturnValue({
        ...createMockUseModelFiltersReturn(items, {
          searchQuery: e.target.value,
        }),
      });
    }),
    items,
    totalItems: items.length,
    clearFilters: vi.fn(),
    selectedItems: [],
    resetModelFiltersFetcher: vi.fn(),
    handleSelectItemChange: vi.fn(),
    getAllEntries: vi.fn(),
    ...overrides,
  };
}

describe("DynamicSelect", () => {
  const defaultModel = { name: "category" as const, queryKey: "name" };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock setup
    mockUseModelFilters.mockReturnValue(createMockUseModelFiltersReturn());
  });

  describe("Basic rendering and selection (backwards compatibility)", () => {
    it("renders without withoutValueItem prop", () => {
      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
        />
      );

      // Should show placeholder
      expect(screen.getByText("Select category")).toBeInTheDocument();
    });

    it("displays items in the popover when opened", async () => {
      const items = createTestItems(3);
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
        />
      );

      const user = userEvent.setup();
      const trigger = screen.getByRole("button");
      await user.click(trigger);

      // All items should be visible
      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
      expect(screen.getByText("Item 3")).toBeInTheDocument();
    });

    it("updates trigger text when regular item is selected", async () => {
      const items = createTestItems(3);
      const onChange = vi.fn();
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          onChange={onChange}
        />
      );

      const user = userEvent.setup();
      const trigger = screen.getByRole("button");
      await user.click(trigger);

      // Click on Item 2
      const item2 = screen.getByText("Item 2");
      await user.click(item2);

      // Trigger should now show "Item 2"
      expect(trigger).toHaveTextContent("Item 2");
      expect(onChange).toHaveBeenCalledWith("item-2");
    });

    it("shows placeholder when nothing is selected", () => {
      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          placeholder="Choose a category"
        />
      );

      expect(screen.getByText("Choose a category")).toBeInTheDocument();
    });
  });

  describe("WithoutValueItem rendering", () => {
    it("renders withoutValueItem when provided", async () => {
      const items = createTestItems(3);
      const withoutValueItem = {
        id: "uncategorized",
        name: "Uncategorized",
      };
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          withoutValueItem={withoutValueItem}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // WithoutValueItem should appear
      expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    });

    it("does not render withoutValueItem when not provided", async () => {
      const items = createTestItems(3);
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // Should only show regular items
      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.queryByText("Uncategorized")).not.toBeInTheDocument();
    });

    it("renders withoutValueItem before regular items", async () => {
      const items = createTestItems(2);
      const withoutValueItem = {
        id: "without-kit",
        name: "Without kit",
      };
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="kits"
          countKey="totalKits"
          contentLabel="Kit"
          withoutValueItem={withoutValueItem}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // Get all text content from the dropdown
      const popoverContent = screen.getByRole("dialog");
      const textContent = popoverContent.textContent || "";

      // Without kit should appear before Item 1 in the text content
      const withoutKitPos = textContent.indexOf("Without kit");
      const item1Pos = textContent.indexOf("Item 1");

      expect(withoutKitPos).toBeGreaterThan(-1); // Should exist
      expect(item1Pos).toBeGreaterThan(-1); // Should exist
      expect(withoutKitPos).toBeLessThan(item1Pos); // Should come before
    });
  });

  describe("WithoutValueItem selection", () => {
    it("can select withoutValueItem by clicking", async () => {
      const items = createTestItems(2);
      const onChange = vi.fn();
      const withoutValueItem = {
        id: "uncategorized",
        name: "Uncategorized",
      };
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          withoutValueItem={withoutValueItem}
          onChange={onChange}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // Click on Uncategorized
      const uncategorizedOption = screen.getByText("Uncategorized");
      await user.click(uncategorizedOption);

      // onChange should be called with the correct ID
      expect(onChange).toHaveBeenCalledWith("uncategorized");
    });

    it("displays withoutValueItem name in trigger when selected", () => {
      const items = createTestItems(2);
      const withoutValueItem = {
        id: "without-location",
        name: "Without location",
      };
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="locations"
          countKey="totalLocations"
          contentLabel="Location"
          withoutValueItem={withoutValueItem}
          defaultValue="without-location"
        />
      );

      const trigger = screen.getByRole("button");
      expect(trigger).toHaveTextContent("Without location");
    });

    it("shows checkmark when withoutValueItem is selected", async () => {
      const items = createTestItems(2);
      const withoutValueItem = {
        id: "untagged",
        name: "Untagged",
      };
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="tags"
          countKey="totalTags"
          contentLabel="Tag"
          withoutValueItem={withoutValueItem}
          defaultValue="untagged"
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // Find the Untagged option in the dropdown (not the trigger)
      const popoverContent = screen.getByRole("dialog");
      const untaggedOptions = within(popoverContent).getAllByText("Untagged");

      // Should be exactly one in the dropdown
      expect(untaggedOptions).toHaveLength(1);

      const untaggedOption = untaggedOptions[0].closest("div");

      // Should have a checkmark icon (CheckIcon renders as svg)
      const checkIcon = untaggedOption?.querySelector("svg");
      expect(checkIcon).toBeInTheDocument();
    });
  });

  describe("Search behavior with withoutValueItem", () => {
    it("shows withoutValueItem when search query is empty", async () => {
      const items = createTestItems(3);
      const withoutValueItem = {
        id: "uncategorized",
        name: "Uncategorized",
      };
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items, { searchQuery: "" })
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          withoutValueItem={withoutValueItem}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // WithoutValueItem should be visible
      expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    });

    it("hides withoutValueItem when user types in search", async () => {
      const items = createTestItems(3);
      const withoutValueItem = {
        id: "uncategorized",
        name: "Uncategorized",
      };

      // Initial state: empty search
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items, { searchQuery: "" })
      );

      const { rerender } = render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          withoutValueItem={withoutValueItem}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // WithoutValueItem should be visible initially
      expect(screen.getByText("Uncategorized")).toBeInTheDocument();

      // Update mock to simulate search query
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items, { searchQuery: "Item" })
      );

      // Re-render to reflect the search state
      rerender(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          withoutValueItem={withoutValueItem}
        />
      );

      // WithoutValueItem should now be hidden
      expect(screen.queryByText("Uncategorized")).not.toBeInTheDocument();
    });

    it("shows withoutValueItem again when search is cleared", async () => {
      const items = createTestItems(3);
      const withoutValueItem = {
        id: "without-kit",
        name: "Without kit",
      };

      // Start with active search
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items, { searchQuery: "laptop" })
      );

      const { rerender } = render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="kits"
          countKey="totalKits"
          contentLabel="Kit"
          withoutValueItem={withoutValueItem}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // WithoutValueItem should be hidden during search
      expect(screen.queryByText("Without kit")).not.toBeInTheDocument();

      // Clear search
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items, { searchQuery: "" })
      );

      rerender(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="kits"
          countKey="totalKits"
          contentLabel="Kit"
          withoutValueItem={withoutValueItem}
        />
      );

      // WithoutValueItem should reappear
      expect(screen.getByText("Without kit")).toBeInTheDocument();
    });

    it("still allows searching regular items when withoutValueItem is provided", async () => {
      const items = createTestItems(3);
      const withoutValueItem = {
        id: "uncategorized",
        name: "Uncategorized",
      };

      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items, { searchQuery: "" })
      );

      render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          withoutValueItem={withoutValueItem}
        />
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // All regular items should be searchable
      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
      expect(screen.getByText("Item 3")).toBeInTheDocument();
    });
  });

  describe("State transitions", () => {
    it("can switch from withoutValueItem to regular item", async () => {
      const items = createTestItems(2);
      const onChange = vi.fn();
      const withoutValueItem = {
        id: "uncategorized",
        name: "Uncategorized",
      };
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      const { rerender } = render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          withoutValueItem={withoutValueItem}
          defaultValue="uncategorized"
          onChange={onChange}
        />
      );

      // Initially showing withoutValueItem
      expect(screen.getByRole("button")).toHaveTextContent("Uncategorized");

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // Select a regular item
      const item1 = screen.getByText("Item 1");
      await user.click(item1);

      // Rerender with new selection
      rerender(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="categories"
          countKey="totalCategories"
          contentLabel="Category"
          withoutValueItem={withoutValueItem}
          defaultValue="item-1"
          onChange={onChange}
        />
      );

      // Should now show the regular item
      expect(screen.getByRole("button")).toHaveTextContent("Item 1");
      expect(onChange).toHaveBeenCalledWith("item-1");
    });

    it("can switch from regular item to withoutValueItem", async () => {
      const items = createTestItems(2);
      const onChange = vi.fn();
      const withoutValueItem = {
        id: "without-custody",
        name: "Without custody",
      };
      mockUseModelFilters.mockReturnValue(
        createMockUseModelFiltersReturn(items)
      );

      const { rerender } = render(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="teamMembers"
          countKey="totalTeamMembers"
          contentLabel="Custodian"
          withoutValueItem={withoutValueItem}
          defaultValue="item-1"
          onChange={onChange}
        />
      );

      // Initially showing regular item
      expect(screen.getByRole("button")).toHaveTextContent("Item 1");

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));

      // Select withoutValueItem
      const withoutCustody = screen.getByText("Without custody");
      await user.click(withoutCustody);

      // Rerender with new selection
      rerender(
        <DynamicSelect
          model={defaultModel}
          initialDataKey="teamMembers"
          countKey="totalTeamMembers"
          contentLabel="Custodian"
          withoutValueItem={withoutValueItem}
          defaultValue="without-custody"
          onChange={onChange}
        />
      );

      // Should now show withoutValueItem
      expect(screen.getByRole("button")).toHaveTextContent("Without custody");
      expect(onChange).toHaveBeenCalledWith("without-custody");
    });
  });
});
