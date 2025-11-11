import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BookingNotes } from "~/components/booking/notes";
import { useFetcher, useLoaderData } from "react-router";

// why: supplying deterministic Remix hooks for BookingNotes component rendering
vi.mock("react-router", async () => {
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
      <a href={typeof to === "string" ? to : ""} {...props}>
        {children}
      </a>
    ),
  };
});

// why: isolating booking note creation form while testing export button rendering
vi.mock("~/components/booking/notes/new", () => ({
  NewBookingNote: () => <div data-testid="new-booking-note-form" />,
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
    firstName: "Casey",
    lastName: "Lee",
  })),
}));

// why: bypass Remix navigation context requirement inside actions dropdown hooks
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: vi.fn(() => false),
}));

const useLoaderDataMock = vi.mocked(useLoaderData);
const useFetcherMock = vi.mocked(useFetcher);

describe("BookingNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLoaderDataMock.mockReturnValue({
      booking: {
        id: "booking-42",
        name: "Studio Session",
        notes: [
          {
            id: "booking-note-1",
            content: "Bring lenses",
            type: "COMMENT",
            createdAt: new Date(),
            dateDisplay: "Today",
          },
        ],
      },
    });
  });

  it("renders a CSV export button for the active booking", () => {
    render(<BookingNotes />);

    expect(useFetcherMock).toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "Export activity CSV" });
    expect(link).toHaveAttribute("download");
    expect(link).toHaveAttribute("href", "/bookings/booking-42/activity.csv");
  });
});
