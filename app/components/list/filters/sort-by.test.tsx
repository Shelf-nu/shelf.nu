import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SortBy } from "./sort-by";

const useIsMobileMock = vi.hoisted(() => vi.fn());
const searchParamsState = vi.hoisted(() => ({
  initial: "",
}));

// why: provide deterministic navigation state for the component under test
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

// why: avoid Radix portal/focus behaviour during component rendering
vi.mock("@radix-ui/react-popover", () => ({
  Popover: ({ children }: any) => <div data-testid="popover">{children}</div>,
  PopoverTrigger: ({ children, asChild, ...props }: any) => (
    <div data-testid="popover-trigger" data-as-child={asChild} {...props}>
      {children}
    </div>
  ),
  PopoverContent: ({ children, ...props }: any) => (
    <div data-testid="popover-content" {...props}>
      {children}
    </div>
  ),
  PopoverPortal: ({ children }: any) => (
    <div data-testid="popover-portal">{children}</div>
  ),
}));

// why: control responsive behaviour for test scenarios
vi.mock("~/hooks/use-mobile", () => ({
  useIsMobile: () => useIsMobileMock(),
}));

// why: emulate Remix search param hook with in-memory state
vi.mock("~/hooks/search-params", async () => {
  const React = (await vi.importActual("react")) as any;

  return {
    useSearchParams: () => {
      const [params, setParams] = React.useState(
        () => new URLSearchParams(searchParamsState.initial)
      );

      const setSearchParams = (
        nextInit:
          | URLSearchParams
          | string
          | ((prev: URLSearchParams) => URLSearchParams)
      ) => {
        if (typeof nextInit === "function") {
          setParams((prev: URLSearchParams) => {
            const clonedPrev = new URLSearchParams(prev);
            const result = nextInit(clonedPrev);
            const next =
              result instanceof URLSearchParams
                ? result
                : new URLSearchParams(result as string);
            searchParamsState.initial = next.toString();
            return next;
          });
          return;
        }

        const next =
          nextInit instanceof URLSearchParams
            ? new URLSearchParams(nextInit)
            : new URLSearchParams(nextInit);
        searchParamsState.initial = next.toString();
        setParams(next);
      };

      return [params, setSearchParams] as const;
    },
  };
});

function setInitialSearchParams(value: string) {
  searchParamsState.initial = value;
}

describe("SortBy", () => {
  beforeEach(() => {
    useIsMobileMock.mockReset();
    useIsMobileMock.mockReturnValue(false);
    setInitialSearchParams("");
  });

  it("renders inline selects on mobile and keeps them in sync with search params", () => {
    useIsMobileMock.mockReturnValue(true);

    render(
      <SortBy
        sortingOptions={{ createdAt: "Date created", name: "Name" }}
        defaultSortingBy="createdAt"
        defaultSortingDirection="desc"
      />
    );

    const orderBySelect = screen.getByLabelText("Sort column");
    const directionSelect = screen.getByLabelText("Sort direction");

    expect(orderBySelect).toHaveValue("createdAt");
    expect(directionSelect).toHaveValue("desc");

    fireEvent.change(orderBySelect, { target: { value: "name" } });
    fireEvent.change(directionSelect, { target: { value: "asc" } });

    expect(orderBySelect).toHaveValue("name");
    expect(directionSelect).toHaveValue("asc");
    expect(screen.queryByTestId("popover-trigger")).not.toBeInTheDocument();
  });

  it("shows popover trigger on desktop with label reflecting current search params", () => {
    useIsMobileMock.mockReturnValue(false);
    setInitialSearchParams("orderBy=name&orderDirection=asc");

    render(
      <SortBy
        sortingOptions={{ createdAt: "Date created", name: "Name" }}
        defaultSortingBy="createdAt"
        defaultSortingDirection="desc"
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Sorted by: Name",
    });

    expect(trigger).toBeInTheDocument();
    expect(screen.getByTestId("popover-content")).toBeInTheDocument();
  });
});
