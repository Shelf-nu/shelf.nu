import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SortBy } from "./sort-by";

const mockNavigationState = vi.hoisted(() => ({ value: "idle" }));
const mockSearchParams = vi.hoisted(
  () => new URLSearchParams("orderBy=createdAt&orderDirection=desc")
);
const mockSetSearchParams = vi.hoisted(() => vi.fn());

// why: control navigation state to test disabled behavior without actual navigation
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    useNavigation: () => ({ state: mockNavigationState.value }),
  };
});

// why: control search params to test URL param handling without actual routing
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams] as const,
}));

// why: Radix Popover doesn't render content in JSDOM, so we render it always for testing
vi.mock("@radix-ui/react-popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverPortal: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverContent: ({ children, ...props }: any) => (
    <div {...props}>{children}</div>
  ),
}));

describe("SortBy", () => {
  const defaultProps = {
    sortingOptions: {
      createdAt: "Date created",
      name: "Name",
      status: "Status",
    },
    defaultSortingBy: "createdAt" as const,
    defaultSortingDirection: "desc" as const,
  };

  beforeEach(() => {
    mockNavigationState.value = "idle";
    mockSearchParams.set("orderBy", "createdAt");
    mockSearchParams.set("orderDirection", "desc");
    mockSetSearchParams.mockReset();
  });

  describe("initialization and URL param handling", () => {
    it("displays current orderBy and orderDirection from URL params", () => {
      render(<SortBy {...defaultProps} />);

      const orderBySelect = screen.getByDisplayValue("Date created");
      const orderDirectionSelect = screen.getByDisplayValue("Descending");

      expect(orderBySelect).toBeInTheDocument();
      expect(orderDirectionSelect).toBeInTheDocument();
    });

    it("uses default values when URL params are empty", () => {
      mockSearchParams.delete("orderBy");
      mockSearchParams.delete("orderDirection");

      render(<SortBy {...defaultProps} />);

      const orderBySelect = screen.getByDisplayValue("Date created");
      const orderDirectionSelect = screen.getByDisplayValue("Descending");

      expect(orderBySelect).toHaveValue("createdAt");
      expect(orderDirectionSelect).toHaveValue("desc");
    });

    it("falls back to default when orderBy is invalid", () => {
      mockSearchParams.set("orderBy", "invalidField");

      render(<SortBy {...defaultProps} />);

      const orderBySelect = screen.getByDisplayValue("Date created");
      expect(orderBySelect).toHaveValue("createdAt");
    });

    it("falls back to default when orderDirection is invalid", () => {
      mockSearchParams.set("orderDirection", "invalid");

      render(<SortBy {...defaultProps} />);

      const orderDirectionSelect = screen.getByDisplayValue("Descending");
      expect(orderDirectionSelect).toHaveValue("desc");
    });

    it("respects valid URL params different from defaults", () => {
      mockSearchParams.set("orderBy", "name");
      mockSearchParams.set("orderDirection", "asc");

      render(<SortBy {...defaultProps} />);

      const orderBySelect = screen.getByDisplayValue("Name");
      const orderDirectionSelect = screen.getByDisplayValue("Ascending");

      expect(orderBySelect).toHaveValue("name");
      expect(orderDirectionSelect).toHaveValue("asc");
    });

    it("shows correct label in trigger button for selected option", () => {
      mockSearchParams.set("orderBy", "status");

      render(<SortBy {...defaultProps} />);

      expect(screen.getByText("Sorted by: Status")).toBeInTheDocument();
    });
  });

  describe("select interactions", () => {
    it("updates URL params immutably when orderBy changes", () => {
      let capturedUpdater: ((prev: URLSearchParams) => URLSearchParams) | null =
        null;

      mockSetSearchParams.mockImplementation((updater) => {
        capturedUpdater = updater as (prev: URLSearchParams) => URLSearchParams;
      });

      render(<SortBy {...defaultProps} />);

      const orderBySelect = screen.getByDisplayValue("Date created");
      fireEvent.change(orderBySelect, { target: { value: "name" } });

      expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
      expect(capturedUpdater).toBeInstanceOf(Function);

      // Verify the updater produces correct new params
      const prevParams = new URLSearchParams(
        "orderBy=createdAt&orderDirection=desc"
      );
      const nextParams = capturedUpdater!(prevParams);

      expect(nextParams.get("orderBy")).toBe("name");
      expect(nextParams.get("orderDirection")).toBe("desc");
      expect(nextParams).not.toBe(prevParams); // Immutability check
    });

    it("updates URL params when orderDirection changes", () => {
      let capturedUpdater: ((prev: URLSearchParams) => URLSearchParams) | null =
        null;

      mockSetSearchParams.mockImplementation((updater) => {
        capturedUpdater = updater as (prev: URLSearchParams) => URLSearchParams;
      });

      render(<SortBy {...defaultProps} />);

      const orderDirectionSelect = screen.getByDisplayValue("Descending");
      fireEvent.change(orderDirectionSelect, { target: { value: "asc" } });

      expect(mockSetSearchParams).toHaveBeenCalledTimes(1);

      // Verify the updater produces correct new params
      const prevParams = new URLSearchParams(
        "orderBy=createdAt&orderDirection=desc"
      );
      const nextParams = capturedUpdater!(prevParams);

      expect(nextParams.get("orderBy")).toBe("createdAt");
      expect(nextParams.get("orderDirection")).toBe("asc");
      expect(nextParams).not.toBe(prevParams);
    });

    it("preserves other URL params when updating orderBy", () => {
      mockSearchParams.set("search", "camera");
      mockSearchParams.set("category", "electronics");

      let capturedUpdater: ((prev: URLSearchParams) => URLSearchParams) | null =
        null;

      mockSetSearchParams.mockImplementation((updater) => {
        capturedUpdater = updater as (prev: URLSearchParams) => URLSearchParams;
      });

      render(<SortBy {...defaultProps} />);

      const orderBySelect = screen.getByDisplayValue("Date created");
      fireEvent.change(orderBySelect, { target: { value: "status" } });

      const prevParams = new URLSearchParams(
        "orderBy=createdAt&orderDirection=desc&search=camera&category=electronics"
      );
      const nextParams = capturedUpdater!(prevParams);

      expect(nextParams.get("orderBy")).toBe("status");
      expect(nextParams.get("search")).toBe("camera");
      expect(nextParams.get("category")).toBe("electronics");
    });
  });

  describe("disabled state", () => {
    it("disables controls when navigation is loading", () => {
      mockNavigationState.value = "loading";

      render(<SortBy {...defaultProps} />);

      const triggerButton = screen.getByRole("button", { name: /sorted by/i });
      const orderBySelect = screen.getByDisplayValue("Date created");
      const orderDirectionSelect = screen.getByDisplayValue("Descending");

      expect(triggerButton).toBeDisabled();
      expect(orderBySelect).toBeDisabled();
      expect(orderDirectionSelect).toBeDisabled();
    });

    it("disables controls when navigation is submitting", () => {
      mockNavigationState.value = "submitting";

      render(<SortBy {...defaultProps} />);

      const triggerButton = screen.getByRole("button", { name: /sorted by/i });
      const orderBySelect = screen.getByDisplayValue("Date created");
      const orderDirectionSelect = screen.getByDisplayValue("Descending");

      expect(triggerButton).toBeDisabled();
      expect(orderBySelect).toBeDisabled();
      expect(orderDirectionSelect).toBeDisabled();
    });

    it("enables controls when navigation is idle", () => {
      mockNavigationState.value = "idle";

      render(<SortBy {...defaultProps} />);

      const triggerButton = screen.getByRole("button", { name: /sorted by/i });
      const orderBySelect = screen.getByDisplayValue("Date created");
      const orderDirectionSelect = screen.getByDisplayValue("Descending");

      expect(triggerButton).not.toBeDisabled();
      expect(orderBySelect).not.toBeDisabled();
      expect(orderDirectionSelect).not.toBeDisabled();
    });
  });

  describe("edge cases", () => {
    it("renders all provided sorting options", () => {
      render(<SortBy {...defaultProps} />);

      const orderBySelect = screen.getByDisplayValue("Date created");
      const options = Array.from(orderBySelect.querySelectorAll("option"));

      expect(options).toHaveLength(3);
      expect(options[0]).toHaveValue("createdAt");
      expect(options[0]).toHaveTextContent("Date created");
      expect(options[1]).toHaveValue("name");
      expect(options[1]).toHaveTextContent("Name");
      expect(options[2]).toHaveValue("status");
      expect(options[2]).toHaveTextContent("Status");
    });

    it("renders with custom className", () => {
      const { container } = render(
        <SortBy {...defaultProps} className="custom-class" />
      );

      // Verify component renders successfully with className prop
      // (actual className application tested via Playwright as it depends on Radix behavior)
      expect(container.firstChild).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /sorted by/i })
      ).toBeInTheDocument();
    });
  });
});
