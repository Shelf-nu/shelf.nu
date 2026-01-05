import type React from "react";
import { useState, useRef, useEffect } from "react";
import { useAtom } from "jotai";
import { X } from "lucide-react";
import type { FetcherWithComponents } from "react-router";
import { fileErrorAtom } from "~/atoms/file";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { useDisabled } from "~/hooks/use-disabled";

export type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type AuditImageUploadDialogProps = {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog should close */
  onClose: () => void;
  /** ID of existing note to attach images to (if attaching to existing note) */
  existingNoteId?: string | null;
  /** Selected images to display */
  selectedImages: SelectedImage[];
  /** Callback when an image is removed */
  onRemoveImage: (id: string) => void;
  /** Callback when images change (for re-opening file picker) */
  onChangeImages: () => void;
  /** Fetcher for form submission */
  fetcher: FetcherWithComponents<unknown>;
  /** Container for portal rendering */
  portalContainer?: HTMLElement;
  /** Maximum number of images allowed */
  maxCount: number;
  /** Number of existing images already uploaded */
  existingImagesCount: number;
};

/**
 * Dialog component for uploading images with an optional note.
 *
 * This component:
 * - Shows previews of selected images
 * - Allows adding an optional text note
 * - Submits with intent="upload-images"
 * - Handles form submission via fetcher
 */
export function AuditImageUploadDialog({
  open,
  onClose,
  existingNoteId,
  selectedImages,
  onRemoveImage,
  onChangeImages,
  fetcher,
  portalContainer,
  maxCount,
  existingImagesCount,
}: AuditImageUploadDialogProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputsRef = useRef<Map<string, HTMLInputElement>>(new Map());
  const [noteContent, setNoteContent] = useState("");
  const [fileError, setFileError] = useAtom(fileErrorAtom);
  const isSubmitting = useDisabled(fetcher);

  // Calculate remaining slots
  const totalImages = existingImagesCount + selectedImages.length;
  const remainingSlots = maxCount - totalImages;
  const canAddMore = remainingSlots > 0;

  // Track previous fetcher state to detect completion
  const prevStateRef = useRef(fetcher.state);

  // Auto-close dialog after successful upload
  useEffect(() => {
    const wasSubmitting =
      prevStateRef.current === "submitting" ||
      prevStateRef.current === "loading";
    const isNowIdle = fetcher.state === "idle";

    if (wasSubmitting && isNowIdle) {
      // Upload completed successfully, close the dialog
      // Clean up note content and close
      setNoteContent("");
      setFileError(undefined);
      onClose();
    }

    prevStateRef.current = fetcher.state;
  }, [fetcher.state, onClose, setFileError]);

  // Prevent closing during submission
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && isSubmitting) {
      // Don't allow closing while submitting
      return;
    }
    if (!newOpen) {
      // Clear error when closing
      setFileError(undefined);
      onClose();
    }
  };

  const setFileInputRef =
    (id: string, file: File) => (el: HTMLInputElement | null) => {
      if (el) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        el.files = dataTransfer.files;
        fileInputsRef.current.set(id, el);
      }
    };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    void fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
    // Don't close here - let useEffect handle closing after upload completes
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        portalProps={{ container: portalContainer }}
        className="max-w-2xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          requestAnimationFrame(() => {
            textareaRef.current?.focus();
          });
        }}
      >
        <fetcher.Form
          method="post"
          encType="multipart/form-data"
          onSubmit={handleSubmit}
        >
          <input
            type="hidden"
            name="intent"
            value={existingNoteId ? "add-images-to-note" : "upload-images"}
          />
          {existingNoteId && (
            <input type="hidden" name="noteId" value={existingNoteId} />
          )}

          <AlertDialogHeader>
            <AlertDialogTitle>
              {existingNoteId ? "Attach Images to Note" : "Upload Images"}
            </AlertDialogTitle>
            <button
              type="button"
              onClick={() => handleOpenChange(false)}
              className="absolute right-6 top-6 rounded-sm opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 disabled:pointer-events-none"
              disabled={isSubmitting}
            >
              <X className="size-4" />
              <span className="sr-only">Close</span>
            </button>
          </AlertDialogHeader>

          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Selected Images ({selectedImages.length}/{maxCount})
                </label>
                {totalImages < maxCount && (
                  <p className="text-xs text-gray-500">
                    You can add {remainingSlots} more image
                    {remainingSlots === 1 ? "" : "s"}
                  </p>
                )}
                {fileError && (
                  <p className="text-sm text-error-500">{fileError}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {selectedImages.map((image) => (
                    <div
                      key={image.id}
                      className="group relative size-24 shrink-0 overflow-hidden rounded-lg border-2 border-gray-200"
                    >
                      <img
                        src={image.previewUrl}
                        alt="Selected"
                        className="size-full object-cover"
                      />
                      {!isSubmitting && (
                        <button
                          type="button"
                          onClick={() => onRemoveImage(image.id)}
                          className="absolute right-1 top-1 rounded-full bg-gray-900/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-900"
                        >
                          <X className="size-3" />
                        </button>
                      )}
                    </div>
                  ))}
                  {!isSubmitting && canAddMore && (
                    <button
                      type="button"
                      onClick={onChangeImages}
                      className="flex size-24 shrink-0 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 transition-colors hover:border-gray-400 hover:bg-gray-100"
                    >
                      <span className="text-xs text-gray-600">Add more</span>
                    </button>
                  )}
                </div>
              </div>

              {!existingNoteId && (
                <div className="space-y-2">
                  <label
                    htmlFor="image-note"
                    className="text-sm font-medium text-gray-700"
                  >
                    Note (Optional)
                  </label>
                  <p className="text-sm text-gray-500">
                    Add a note to accompany these images.
                  </p>
                  <textarea
                    ref={textareaRef}
                    id="image-note"
                    name="content"
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Add a note about these images..."
                    className="min-h-[100px] w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-primary-300 focus:outline-none focus:ring-2 focus:ring-primary-300/20"
                    rows={4}
                    disabled={isSubmitting}
                  />
                </div>
              )}
              {existingNoteId && (
                <p className="text-sm text-gray-500">
                  Images will be added to the existing note.
                </p>
              )}
            </div>
          </AlertDialogDescription>

          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel asChild>
              <Button variant="secondary" type="button" disabled={isSubmitting}>
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting || selectedImages.length === 0}
            >
              {isSubmitting ? "Uploading..." : "Upload Images"}
            </Button>
          </AlertDialogFooter>

          {/* Hidden file inputs to submit files with the form */}
          {selectedImages.map((image) => (
            <input
              ref={setFileInputRef(image.id, image.file)}
              key={image.id}
              type="file"
              name="images"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
            />
          ))}
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
