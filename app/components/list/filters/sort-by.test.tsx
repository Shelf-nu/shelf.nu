import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SortBy } from "./sort-by";

const popoverEvents = vi.hoisted(
  () => [] as Array<{ preventDefault: ReturnType<typeof vi.fn> }>
);
const searchParamsState = vi.hoisted(() => ({ value: "" }));
const setSearchParamsMock = vi.hoisted(() => vi.fn());

// why: keep navigation idle so the component stays enabled during the test
vi.mock("@remix-run/react", async () => {
  const actual = (await vi.importActual("@remix-run/react")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    useNavigation: () => ({ state: "idle" }),
  };
});

// why: capture onOpenAutoFocus so we can assert the focus trap is disabled
vi.mock("@radix-ui/react-popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children, asChild, ...props }: any) => (
    <div data-testid="popover-trigger" data-as-child={asChild} {...props}>
      {children}
    </div>
  ),
  PopoverPortal: ({ children }: any) => (
    <div data-testid="popover-portal">{children}</div>
  ),
  PopoverContent: ({ children, onOpenAutoFocus, ...props }: any) => {
    if (typeof onOpenAutoFocus === "function") {
      const event = { preventDefault: vi.fn() };
      onOpenAutoFocus(event as any);
      popoverEvents.push(event as any);
    }

    return (
      <div data-testid="popover-content" {...props}>
        {children}
      </div>
    );
  },
}));

// why: provide deterministic search params for assertions
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [
    new URLSearchParams(searchParamsState.value),
    setSearchParamsMock,
  ] as const,
}));

describe("SortBy", () => {
  beforeEach(() => {
    popoverEvents.length = 0;
    searchParamsState.value = "orderBy=createdAt&orderDirection=desc";
    setSearchParamsMock.mockReset();
  });

  it("prevents the popover content from auto focusing the first select", () => {
    render(
      <SortBy
        sortingOptions={{ createdAt: "Date created", name: "Name" }}
        defaultSortingBy="createdAt"
        defaultSortingDirection="desc"
      />
    );

    expect(popoverEvents).toHaveLength(1);
    expect(popoverEvents[0]?.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("updates search params immutably when a new column is selected", () => {
    setSearchParamsMock.mockImplementation((updater: any) => {
      if (typeof updater !== "function") {
        throw new Error("expected function updater");
      }

      const prev = new URLSearchParams(searchParamsState.value);
      const next = updater(prev);

      expect(prev.get("orderBy")).toBe("createdAt");
      expect(next.get("orderBy")).toBe("name");
      expect(next).not.toBe(prev);
    });

    render(
      <SortBy
        sortingOptions={{ createdAt: "Date created", name: "Name" }}
        defaultSortingBy="createdAt"
        defaultSortingDirection="desc"
      />
    );

    const [orderBySelect] = screen.getAllByRole("combobox");
    fireEvent.change(orderBySelect, { target: { value: "name" } });

    expect(setSearchParamsMock).toHaveBeenCalledTimes(1);
  });
});
