import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuditAssetNoteItem,
  type NoteData,
} from "~/components/audit/audit-asset-note-item";

// why: providing stable Remix hooks for rendering AuditAssetNoteItem in isolation
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");

  return {
    ...actual,
    useFetcher: vi.fn(() => ({
      Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
      state: "idle",
      data: null,
      formData: null,
      submit: vi.fn(),
    })),
  };
});

// why: avoid Remix router dependency inside date component for isolated rendering
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: string | Date }) => (
    <time data-testid="note-date">{String(date)}</time>
  ),
}));

// why: isolating markdown rendering to avoid complex markdoc dependencies
vi.mock("~/components/markdown/markdown-viewer", () => ({
  MarkdownViewer: ({ content }: { content: string }) => (
    <div data-testid="markdown-content">{content}</div>
  ),
}));

// why: simplifying user badge rendering for note item tests
vi.mock("~/components/shared/user-badge", () => ({
  UserBadge: ({ name }: { name: string }) => (
    <span data-testid="user-badge">{name}</span>
  ),
}));

describe("AuditAssetNoteItem", () => {
  const mockCommentNote: NoteData = {
    id: "note-1",
    content: "Test note content",
    createdAt: new Date("2024-01-15"),
    userId: "user-1",
    type: "COMMENT",
    user: {
      id: "user-1",
      name: "John Doe",
      img: null,
    },
  };

  const mockUpdateNote: NoteData = {
    id: "note-2",
    content: "System generated note",
    createdAt: new Date("2024-01-15"),
    userId: "user-1",
    type: "UPDATE",
    user: {
      id: "user-1",
      name: "John Doe",
      img: null,
    },
  };

  const mockTempNote: NoteData = {
    id: "temp-123",
    content: "Temporary note",
    createdAt: new Date("2024-01-15"),
    userId: "user-1",
    type: "COMMENT",
    user: {
      id: "user-1",
      name: "John Doe",
      img: null,
    },
    needsServerSync: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("attach images button visibility", () => {
    it("shows attach button for COMMENT notes when callback provided", () => {
      const onAttachImages = vi.fn();
      render(
        <AuditAssetNoteItem
          note={mockCommentNote}
          onAttachImages={onAttachImages}
        />
      );

      expect(
        screen.getByTitle("Attach images to this note")
      ).toBeInTheDocument();
    });

    it("does not show attach button for UPDATE notes", () => {
      const onAttachImages = vi.fn();
      render(
        <AuditAssetNoteItem
          note={mockUpdateNote}
          onAttachImages={onAttachImages}
        />
      );

      expect(
        screen.queryByTitle("Attach images to this note")
      ).not.toBeInTheDocument();
    });

    it("does not show attach button for temp notes (not yet saved)", () => {
      const onAttachImages = vi.fn();
      render(
        <AuditAssetNoteItem
          note={mockTempNote}
          onAttachImages={onAttachImages}
        />
      );

      expect(
        screen.queryByTitle("Attach images to this note")
      ).not.toBeInTheDocument();
    });

    it("does not show attach button when callback not provided", () => {
      render(<AuditAssetNoteItem note={mockCommentNote} />);

      expect(
        screen.queryByTitle("Attach images to this note")
      ).not.toBeInTheDocument();
    });
  });

  describe("attach images button state", () => {
    it("enables attach button when below image limit", () => {
      const onAttachImages = vi.fn();
      render(
        <AuditAssetNoteItem
          note={mockCommentNote}
          onAttachImages={onAttachImages}
          currentImageCount={1}
          maxImageCount={3}
        />
      );

      const button = screen.getByTitle("Attach images to this note");
      expect(button).not.toBeDisabled();
    });

    it("enables attach button when at zero images", () => {
      const onAttachImages = vi.fn();
      render(
        <AuditAssetNoteItem
          note={mockCommentNote}
          onAttachImages={onAttachImages}
          currentImageCount={0}
          maxImageCount={3}
        />
      );

      const button = screen.getByTitle("Attach images to this note");
      expect(button).not.toBeDisabled();
    });

    it("disables attach button when at maximum image limit", () => {
      const onAttachImages = vi.fn();
      render(
        <AuditAssetNoteItem
          note={mockCommentNote}
          onAttachImages={onAttachImages}
          currentImageCount={3}
          maxImageCount={3}
        />
      );

      const button = screen.getByTitle("Maximum 3 images allowed");
      expect(button).toBeDisabled();
    });

    it("disables attach button when exceeding image limit", () => {
      const onAttachImages = vi.fn();
      render(
        <AuditAssetNoteItem
          note={mockCommentNote}
          onAttachImages={onAttachImages}
          currentImageCount={5}
          maxImageCount={3}
        />
      );

      const button = screen.getByTitle("Maximum 3 images allowed");
      expect(button).toBeDisabled();
    });

    it("uses default values when counts not provided", () => {
      const onAttachImages = vi.fn();
      render(
        <AuditAssetNoteItem
          note={mockCommentNote}
          onAttachImages={onAttachImages}
          // No currentImageCount or maxImageCount provided
        />
      );

      // Default is 0 images, max 3, so button should be enabled
      const button = screen.getByTitle("Attach images to this note");
      expect(button).not.toBeDisabled();
    });
  });

  describe("note content rendering", () => {
    it("renders note content via MarkdownViewer", () => {
      render(<AuditAssetNoteItem note={mockCommentNote} />);

      expect(screen.getByTestId("markdown-content")).toHaveTextContent(
        "Test note content"
      );
    });

    it("displays user name via UserBadge", () => {
      render(<AuditAssetNoteItem note={mockCommentNote} />);

      expect(screen.getByTestId("user-badge")).toHaveTextContent("John Doe");
    });

    it("displays creation date", () => {
      render(<AuditAssetNoteItem note={mockCommentNote} />);

      expect(screen.getByTestId("note-date")).toBeInTheDocument();
    });
  });

  describe("delete button visibility", () => {
    it("shows delete button for COMMENT notes", () => {
      const onDelete = vi.fn();
      render(<AuditAssetNoteItem note={mockCommentNote} onDelete={onDelete} />);

      // Delete button has no accessible name, just an icon
      const buttons = screen.getAllByRole("button");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAttribute("type", "submit");
    });

    it("does not show delete button for UPDATE notes", () => {
      const onDelete = vi.fn();
      render(<AuditAssetNoteItem note={mockUpdateNote} onDelete={onDelete} />);

      // Should have no buttons at all
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("does not show delete button when callback not provided", () => {
      render(<AuditAssetNoteItem note={mockCommentNote} />);

      // Should have no buttons at all
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
