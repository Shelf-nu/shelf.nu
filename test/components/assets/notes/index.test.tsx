import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Notes } from "~/components/assets/notes";
import { useFetcher, useLoaderData } from "react-router";

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

describe("Notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLoaderDataMock.mockReturnValue({
      asset: {
        id: "asset-123",
        title: "Studio Camera",
        notes: [
          {
            id: "note-1",
            content: "Sample",
            type: "COMMENT",
            createdAt: new Date(),
            dateDisplay: "Today",
          },
        ],
      },
    });
  });

  it("renders an export button linked to the asset activity CSV", () => {
    render(<Notes />);

    expect(useFetcherMock).toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "Export activity CSV" });
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("href", "/assets/asset-123/activity.csv");
  });
});
