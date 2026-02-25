import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuditImageUploadDialog,
  type SelectedImage,
} from "~/components/audit/audit-image-upload-dialog";

// why: providing stable Remix navigation mock for useDisabled hook
vi.mock("react-router", async () => {
  const actual =
    await vi.importActual<typeof import("react-router")>("react-router");

  return {
    ...actual,
    useNavigation: vi.fn(() => ({
      state: "idle",
      location: undefined,
      formMethod: undefined,
      formAction: undefined,
      formEncType: undefined,
      formData: undefined,
    })),
  };
});

// why: isolating file error state management from global atoms
vi.mock("~/atoms/file", () => ({
  fileErrorAtom: {
    read: () => undefined,
    write: () => {},
  },
}));

// why: providing stable Remix fetcher mock for form submission
const mockFetcher = {
  Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
  state: "idle" as const,
  data: null,
  formData: null,
  formMethod: undefined,
  formAction: undefined,
  formEncType: undefined,
  text: undefined,
  json: undefined,
  load: vi.fn(),
  submit: vi.fn(),
} as any; // Cast to avoid typing entire FetcherWithComponents interface

describe("AuditImageUploadDialog", () => {
  const mockImage1: SelectedImage = {
    id: "img-1",
    file: new File(["content1"], "image1.jpg", { type: "image/jpeg" }),
    previewUrl: "blob:http://localhost/img-1",
  };

  const mockImage2: SelectedImage = {
    id: "img-2",
    file: new File(["content2"], "image2.png", { type: "image/png" }),
    previewUrl: "blob:http://localhost/img-2",
  };

  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    existingNoteId: null,
    selectedImages: [mockImage1],
    onRemoveImage: vi.fn(),
    onChangeImages: vi.fn(),
    fetcher: mockFetcher,
    maxCount: 3,
    existingImagesCount: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("dialog title and content", () => {
    it("shows 'Upload Images' title when uploading new images", () => {
      render(<AuditImageUploadDialog {...defaultProps} />);

      expect(
        screen.getByRole("heading", { name: "Upload Images" })
      ).toBeInTheDocument();
    });

    it("shows 'Attach Images to Note' title when attaching to existing note", () => {
      render(
        <AuditImageUploadDialog {...defaultProps} existingNoteId="note-1" />
      );

      expect(
        screen.getByRole("heading", { name: "Attach Images to Note" })
      ).toBeInTheDocument();
    });

    it("shows textarea for new uploads", () => {
      render(<AuditImageUploadDialog {...defaultProps} />);

      expect(
        screen.getByPlaceholderText("Add a note about these images...")
      ).toBeInTheDocument();
    });

    it("hides textarea when attaching to existing note", () => {
      render(
        <AuditImageUploadDialog {...defaultProps} existingNoteId="note-1" />
      );

      expect(
        screen.queryByPlaceholderText("Add a note about these images...")
      ).not.toBeInTheDocument();
    });

    it("shows helper text when attaching to existing note", () => {
      render(
        <AuditImageUploadDialog {...defaultProps} existingNoteId="note-1" />
      );

      expect(
        screen.getByText("Images will be added to the existing note.")
      ).toBeInTheDocument();
    });
  });

  describe("image preview rendering", () => {
    it("displays single image preview", () => {
      render(<AuditImageUploadDialog {...defaultProps} />);

      const previews = screen.getAllByRole("img");
      expect(previews).toHaveLength(1);
      expect(previews[0]).toHaveAttribute("src", mockImage1.previewUrl);
    });

    it("displays multiple image previews", () => {
      render(
        <AuditImageUploadDialog
          {...defaultProps}
          selectedImages={[mockImage1, mockImage2]}
        />
      );

      const previews = screen.getAllByRole("img");
      expect(previews).toHaveLength(2);
      expect(previews[0]).toHaveAttribute("src", mockImage1.previewUrl);
      expect(previews[1]).toHaveAttribute("src", mockImage2.previewUrl);
    });

    it("shows remove button on each image", () => {
      render(
        <AuditImageUploadDialog
          {...defaultProps}
          selectedImages={[mockImage1, mockImage2]}
        />
      );

      const removeButtons = screen.getAllByRole("button", { name: "" });
      // Should have 2 remove buttons (one per image) plus Cancel and Upload buttons
      expect(removeButtons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("remove image functionality", () => {
    it("calls onRemoveImage when remove button clicked", async () => {
      const user = userEvent.setup();
      const onRemoveImage = vi.fn();

      render(
        <AuditImageUploadDialog
          {...defaultProps}
          onRemoveImage={onRemoveImage}
        />
      );

      const removeButtons = screen.getAllByRole("button", { name: "" });
      // First remove button (not Cancel or Upload)
      await user.click(removeButtons[0]);

      expect(onRemoveImage).toHaveBeenCalledWith(mockImage1.id);
    });
  });

  describe("Add more button", () => {
    it("is enabled when slots available", () => {
      render(
        <AuditImageUploadDialog
          {...defaultProps}
          selectedImages={[mockImage1]}
          existingImagesCount={0}
          maxCount={3}
        />
      );

      const addMoreButton = screen.getByText("Add more");
      expect(addMoreButton).not.toBeDisabled();
    });

    it("is disabled when at maximum capacity", () => {
      render(
        <AuditImageUploadDialog
          {...defaultProps}
          selectedImages={[mockImage1, mockImage2]}
          existingImagesCount={1}
          maxCount={3}
        />
      );

      // Find the actual button element, not the text inside it
      const addMoreButton = screen.getByRole("button", { name: /add more/i });
      expect(addMoreButton).toBeDisabled();
    });

    it("calls onChangeImages when clicked", async () => {
      const user = userEvent.setup();
      const onChangeImages = vi.fn();

      render(
        <AuditImageUploadDialog
          {...defaultProps}
          onChangeImages={onChangeImages}
        />
      );

      const addMoreButton = screen.getByText("Add more");
      await user.click(addMoreButton);

      expect(onChangeImages).toHaveBeenCalledTimes(1);
    });
  });

  describe("form submission", () => {
    it("includes upload-images intent for new uploads", () => {
      render(<AuditImageUploadDialog {...defaultProps} />);

      const intentInput = screen.getByDisplayValue("upload-images");
      expect(intentInput).toBeInTheDocument();
      expect(intentInput).toHaveAttribute("name", "intent");
    });

    it("includes add-images-to-note intent when attaching", () => {
      render(
        <AuditImageUploadDialog {...defaultProps} existingNoteId="note-1" />
      );

      const intentInput = screen.getByDisplayValue("add-images-to-note");
      expect(intentInput).toBeInTheDocument();
    });

    it("includes noteId when attaching to existing note", () => {
      render(
        <AuditImageUploadDialog {...defaultProps} existingNoteId="note-123" />
      );

      const noteIdInput = screen.getByDisplayValue("note-123");
      expect(noteIdInput).toBeInTheDocument();
      expect(noteIdInput).toHaveAttribute("name", "noteId");
    });

    it("does not include noteId for new uploads", () => {
      render(<AuditImageUploadDialog {...defaultProps} />);

      expect(screen.queryByDisplayValue(/note-/)).not.toBeInTheDocument();
    });
  });

  describe("dialog state management", () => {
    it("calls onClose when Cancel clicked", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(<AuditImageUploadDialog {...defaultProps} onClose={onClose} />);

      const cancelButton = screen.getByText("Cancel");
      await user.click(cancelButton);

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("shows loading state during submission", () => {
      const submittingFetcher = {
        ...mockFetcher,
        state: "submitting" as const,
      };

      render(
        <AuditImageUploadDialog {...defaultProps} fetcher={submittingFetcher} />
      );

      // Loading state shows on the Upload button
      const uploadButton = screen.getByRole("button", { name: "Uploading..." });
      expect(uploadButton).toBeDisabled();
    });

    it("prevents closing dialog during submission", () => {
      const submittingFetcher = {
        ...mockFetcher,
        state: "submitting" as const,
      };

      render(
        <AuditImageUploadDialog {...defaultProps} fetcher={submittingFetcher} />
      );

      const uploadButton = screen.getByRole("button", { name: "Uploading..." });
      expect(uploadButton).toBeDisabled();
      // Cancel button should also be disabled - query by role
      const cancelButton = screen.getByRole("button", { name: "Cancel" });
      expect(cancelButton).toBeDisabled();
    });
  });

  describe("auto-close behavior", () => {
    it("closes dialog after successful upload", async () => {
      const onClose = vi.fn();

      const { rerender } = render(
        <AuditImageUploadDialog
          {...defaultProps}
          onClose={onClose}
          fetcher={{ ...mockFetcher, state: "submitting" as const }}
        />
      );

      // Simulate transition from submitting to idle
      rerender(
        <AuditImageUploadDialog
          {...defaultProps}
          onClose={onClose}
          fetcher={{ ...mockFetcher, state: "idle" as const }}
        />
      );

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });

    it("does not close if fetcher was already idle", () => {
      const onClose = vi.fn();

      render(
        <AuditImageUploadDialog
          {...defaultProps}
          onClose={onClose}
          fetcher={{ ...mockFetcher, state: "idle" as const }}
        />
      );

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
