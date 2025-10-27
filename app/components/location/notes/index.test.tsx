import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LocationNotes } from "./index";

const mockFetcher = {
  Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
  submit: vi.fn(),
  load: vi.fn(),
  data: undefined,
  state: "idle" as "idle" | "submitting" | "loading",
  formData: undefined as FormData | undefined,
};

const useLoaderDataMock = vi.fn();
const useFetcherMock = vi.fn(() => mockFetcher);
const useParamsMock = vi.fn(() => ({ locationId: "loc-1" }));

vi.mock("@remix-run/react", async () => {
  const actual = await vi.importActual("@remix-run/react");
  return {
    ...actual,
    useLoaderData: useLoaderDataMock,
    useFetcher: useFetcherMock,
    useParams: useParamsMock,
  };
});

vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ firstName: "Ada", lastName: "Lovelace" }),
}));

vi.mock("~/components/markdown/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

vi.mock("~/components/markdown/markdown-editor", () => ({
  MarkdownEditor: (props: any) => <textarea {...props} />,
}));

vi.mock("~/components/forms/input", () => ({
  default: (props: any) => <input {...props} />,
}));

vi.mock("~/components/shared/button", () => ({
  Button: (props: any) => <button {...props} />,
}));

describe("LocationNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetcher.state = "idle";
    mockFetcher.formData = undefined;
  });

  it("renders existing notes", () => {
    useLoaderDataMock.mockReturnValue({
      location: { id: "loc-1" },
      notes: [
        {
          id: "lnote-1",
          content: "Checked HVAC filters",
          type: "COMMENT",
          createdAt: new Date("2024-01-01T10:00:00Z"),
          dateDisplay: "1/1/24, 10:00 AM",
          user: { firstName: "Grace", lastName: "Hopper" },
        },
      ],
    });

    render(<LocationNotes />);

    expect(screen.getByText("Checked HVAC filters")).toBeInTheDocument();
    expect(screen.getByText("1/1/24, 10:00 AM")).toBeInTheDocument();
  });

  it("shows optimistic note while submitting", () => {
    useLoaderDataMock.mockReturnValue({
      location: { id: "loc-1" },
      notes: [],
    });

    mockFetcher.state = "submitting";
    const formData = new FormData();
    formData.set("content", "Replacing exit signs");
    mockFetcher.formData = formData;

    render(<LocationNotes />);

    expect(screen.getByText("Replacing exit signs")).toBeInTheDocument();
    expect(screen.getByText(/Just Now/i)).toBeInTheDocument();
  });
});
