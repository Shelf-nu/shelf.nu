import { useFetcher, useLoaderData } from "@remix-run/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocationNotes } from "~/components/location/notes";

// why: supplying deterministic Remix hooks for LocationNotes component rendering
vi.mock("@remix-run/react", async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual =
    await vi.importActual<typeof import("@remix-run/react")>(
      "@remix-run/react"
    );

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
      // eslint-disable-next-line jsx-a11y/anchor-is-valid
      <a href={typeof to === "string" ? to : "#"} {...props}>
        {children}
      </a>
    ),
  };
});

// why: isolating location note creation form while testing export button rendering
vi.mock("~/components/location/notes/new", () => ({
  NewLocationNote: () => <div data-testid="new-location-note-form" />,
}));

// why: avoid creating a Remix router context for shared date component usage
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: string }) => (
    <time data-testid="note-date">{String(date)}</time>
  ),
}));

// why: preventing Remix loader dependency for user data hook usage
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: vi.fn(() => ({
    firstName: "Ada",
    lastName: "Lovelace",
  })),
}));

// why: bypass Remix navigation context requirement inside actions dropdown hooks
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: vi.fn(() => false),
}));

// why: avoid markdown parsing complexity in component tests
vi.mock("~/components/markdown/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);
const useFetcherMock = vi.mocked(useFetcher);

describe("LocationNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLoaderDataMock.mockReturnValue({
      location: { id: "loc-1", name: "Main Office" },
      notes: [
        {
          id: "lnote-1",
          content: "Checked HVAC filters",
          type: "COMMENT",
          createdAt: new Date("2024-01-01T10:00:00Z").toISOString(),
          user: { firstName: "Grace", lastName: "Hopper" },
        },
      ],
    });
  });

  it("renders existing notes", () => {
    render(<LocationNotes />);

    expect(screen.getByText("Checked HVAC filters")).toBeInTheDocument();
    expect(screen.getByTestId("note-date")).toBeInTheDocument();
  });

  it("renders a CSV export button for the active location", () => {
    render(<LocationNotes />);

    expect(useFetcherMock).toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "Export activity CSV" });
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("href", "/locations/loc-1/activity.csv");
  });

  it("shows optimistic note while submitting", () => {
    useLoaderDataMock.mockReturnValue({
      location: { id: "loc-1", name: "Main Office" },
      notes: [],
    });

    const formData = new FormData();
    formData.set("content", "Replacing exit signs");

    useFetcherMock.mockReturnValue({
      Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
      state: "submitting",
      data: null,
      formData,
      submit: vi.fn(),
    } as any);

    render(<LocationNotes />);

    expect(screen.getByText("Replacing exit signs")).toBeInTheDocument();
  });

  it("does not render export button when there are no notes", () => {
    useLoaderDataMock.mockReturnValue({
      location: { id: "loc-1", name: "Main Office" },
      notes: [],
    });

    render(<LocationNotes />);

    expect(
      screen.queryByRole("link", { name: "Export activity CSV" })
    ).not.toBeInTheDocument();
  });
});
