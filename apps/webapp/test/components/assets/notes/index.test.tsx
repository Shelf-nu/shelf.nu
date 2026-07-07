import type { ReactNode } from "react";
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
  Filters: ({ children }: { children: ReactNode }) => (
    <div data-testid="filters">{children}</div>
  ),
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

/**
 * Builds the activity-route loader payload the Notes component reads. Tests
 * override only the fields a scenario cares about.
 * - `hasNotes` is the UNFILTERED "asset has any notes" flag and gates the export
 *   button (independent of the filtered `totalItems`).
 * - `page` and `search` gate the optimistic-comment placeholder.
 */
function makeLoaderData(overrides = {}) {
  return {
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
    hasNotes: true,
    modelName: { singular: "note", plural: "notes" },
    searchFieldLabel: "Search notes",
    ...overrides,
  };
}

/**
 * An idle add-note fetcher matching the react-router mock default. Re-applied in
 * `beforeEach` because `vi.clearAllMocks()` clears call history but NOT return
 * values, so a submitting override in one test would otherwise leak into later
 * tests. `Form` is omitted deliberately: it is only rendered inside a closed
 * (lazily mounted) delete dialog, so it is never read during these renders.
 */
const idleFetcher = {
  state: "idle",
  data: null,
  formData: null,
  submit: vi.fn(),
} as unknown as ReturnType<typeof useFetcher>;

/** Builds a submitting add-note fetcher carrying the given comment content. */
function submittingFetcher(content: string) {
  const formData = new FormData();
  formData.append("content", content);
  return {
    state: "submitting",
    data: null,
    formData,
    submit: vi.fn(),
  } as unknown as ReturnType<typeof useFetcher>;
}

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
    useLoaderDataMock.mockReturnValue(makeLoaderData());
    // why: restore the idle fetcher each test — mock return values survive
    // clearAllMocks, so a submitting override would otherwise persist.
    useFetcherMock.mockReturnValue(idleFetcher);
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
    useLoaderDataMock.mockReturnValue(
      makeLoaderData({
        items: [],
        totalItems: 0,
        totalPages: 0,
        hasNotes: false,
      })
    );

    renderNotes();

    expect(screen.getByText("No Notes")).toBeInTheDocument();
  });

  it("keeps the export button visible when an active filter matches no notes", () => {
    // why: totalItems is the FILTERED count, but the CSV endpoint exports the
    // full unfiltered activity log — so the button must key off hasNotes, not
    // the filtered count. A filter/search matching zero notes must not hide it.
    useLoaderDataMock.mockReturnValue(
      makeLoaderData({
        items: [],
        totalItems: 0,
        totalPages: 0,
        search: "no-such-note", // active search that matches nothing
        hasNotes: true, // the asset still has notes overall
      })
    );

    renderNotes();

    expect(
      screen.getByRole("link", { name: "Export activity CSV" })
    ).toBeInTheDocument();
    // the filtered view is empty, so the "no matching activity" state is shown
    expect(screen.getByText("No matching activity")).toBeInTheDocument();
  });

  it("shows the optimistic comment on page 1 with no active search", () => {
    // why: an in-flight add-note fetcher (submitting + content) is what triggers
    // the optimistic placeholder; on page 1 with no search the new comment
    // belongs in the current view, so it should render immediately.
    useFetcherMock.mockReturnValue(submittingFetcher("Optimistic comment"));
    useLoaderDataMock.mockReturnValue(
      makeLoaderData({ items: [], totalItems: 0, totalPages: 0 })
    );

    renderNotes();

    expect(screen.getByText("Optimistic comment")).toBeInTheDocument();
  });

  it("hides the optimistic comment while a search term is active", () => {
    // why: identical in-flight add-note fetcher to the positive case; the ONLY
    // difference is an active search. A new comment lands on page 1 unfiltered,
    // so it would not appear in a searched view — rendering it would flash then
    // vanish on revalidation, so it must be suppressed.
    useFetcherMock.mockReturnValue(submittingFetcher("Optimistic comment"));
    useLoaderDataMock.mockReturnValue(
      makeLoaderData({
        items: [],
        totalItems: 0,
        totalPages: 0,
        search: "camera",
      })
    );

    renderNotes();

    expect(screen.queryByText("Optimistic comment")).not.toBeInTheDocument();
    // the searched view has no matching notes, so the empty-filter state shows
    expect(screen.getByText("No matching activity")).toBeInTheDocument();
  });
});
