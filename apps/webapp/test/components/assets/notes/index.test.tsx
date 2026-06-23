import { render, screen } from "@testing-library/react";
import { MemoryRouter, useFetcher, useLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Notes } from "~/components/assets/notes";

// why: providing stable Remix hooks for rendering Notes component in isolation
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");

  return {
    ...actual,
    useLoaderData: vi.fn(),
    useFetcher: vi.fn(() => ({
      Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
      state: "idle",
      data: null,
      formData: null,
      submit: vi.fn(),
    })),
    Link: ({ to, children, ...props }: any) => (
      <a href={typeof to === "string" ? to : ""} {...props}>
        {children}
      </a>
    ),
  };
});

// why: the activity log now reads URL state via the shared search-params hook;
// stub it so the component renders without the cookie-filter router plumbing
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

// why: the shared list toolbar primitives depend on a data-router context
// (useNavigation) that's impractical to set up here and are covered by their
// own tests; stub them so this stays a focused test of the activity log.
// Filters renders its children so the export button remains assertable.
vi.mock("~/components/list/filters", () => ({
  Filters: ({ children }: any) => <div data-testid="filters">{children}</div>,
}));
vi.mock("~/components/list/pagination", () => ({
  Pagination: () => <div data-testid="pagination" />,
}));
vi.mock("~/components/booking/status-filter", () => ({
  StatusFilter: () => <div data-testid="status-filter" />,
}));

// why: isolating note creation form during Notes component tests
vi.mock("~/components/assets/notes/new", () => ({
  NewNote: () => <div data-testid="new-note-form" />,
}));

// why: avoid Remix router dependency inside date component for isolated rendering
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: string }) => (
    <time data-testid="note-date">{String(date)}</time>
  ),
}));

// why: avoiding Remix loader context requirements for user data hook
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: vi.fn(() => ({
    firstName: "Carlos",
    lastName: "Virreira",
  })),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);
const useFetcherMock = vi.mocked(useFetcher);

/** Renders Notes inside a router so the shared list toolbar hooks resolve */
function renderNotes() {
  return render(
    <MemoryRouter>
      <Notes />
    </MemoryRouter>
  );
}

describe("Notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLoaderDataMock.mockReturnValue({
      asset: {
        id: "asset-123",
        title: "Studio Camera",
      },
      items: [
        {
          id: "note-1",
          content: "Sample",
          type: "COMMENT",
          createdAt: new Date(),
          user: { firstName: "Carlos", lastName: "Virreira" },
        },
      ],
      totalItems: 1,
      page: 1,
      perPage: 20,
      totalPages: 1,
      search: null,
      modelName: { singular: "note", plural: "notes" },
      searchFieldLabel: "Search notes",
    });
  });

  it("renders an export button linked to the asset activity CSV", () => {
    renderNotes();

    expect(useFetcherMock).toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "Export activity CSV" });
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("href", "/assets/asset-123/activity.csv");
  });

  it("renders the current page of notes", () => {
    renderNotes();

    expect(screen.getByText("Sample")).toBeInTheDocument();
  });

  it("shows the empty state when the asset has no notes and no active filter", () => {
    useLoaderDataMock.mockReturnValue({
      asset: { id: "asset-123", title: "Studio Camera" },
      items: [],
      totalItems: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
      search: null,
      modelName: { singular: "note", plural: "notes" },
      searchFieldLabel: "Search notes",
    });

    renderNotes();

    expect(screen.getByText("No Notes")).toBeInTheDocument();
  });
});
