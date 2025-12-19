import { useEffect, useRef, useOptimistic, startTransition } from "react";
import type { ChangeEvent, RefObject } from "react";
import type { FetcherWithComponents } from "react-router";
import { useFetcher } from "react-router";
import useApiQuery from "~/hooks/use-api-query";

/**
 * @deprecated This hook is being refactored to use a simpler pattern.
 * See AuditAssetDetailsDialog component for the new implementation.
 *
 * The new approach:
 * - Uses local state for optimistic UI (no useOptimistic hook)
 * - Each note component has its own fetcher with unique key
 * - Notes/images pre-fetched in scan route loader
 *
 * TODO: Remove this file once refactor is complete and tested.
 */

/**
 * Type definition for note data returned from the API.
 * Notes are specific to an audit asset and track comments/updates.
 */
export type NoteData = {
  id: string;
  content: string;
  createdAt: string | Date;
  userId: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    profilePicture: string | null;
  };
};

/**
 * Type definition for image data returned from the API.
 * Images are uploaded to specific audit assets for documentation.
 */
export type ImageData = {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  description: string | null;
  createdAt: string | Date;
  uploadedBy: {
    id: string;
    firstName: string;
    lastName: string;
    profilePicture: string | null;
  };
};

type UseAuditAssetDetailsParams = {
  auditSessionId: string;
  auditAssetId: string;
  open: boolean;
};

type UseAuditAssetDetailsReturn = {
  optimisticNotes: NoteData[];
  images: ImageData[];
  handleNoteFormAction: (formData: FormData) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  noteFormRef: RefObject<HTMLFormElement | null>;
  isLoadingNotes: boolean;
  isLoadingImages: boolean;
  isUploadingImage: boolean;
  isMutatingImage: boolean;
  noteFetcher: FetcherWithComponents<any>;
  noteDeleteFetcher: FetcherWithComponents<any>;
  handleImageUpload: () => void;
  handleFileSelected: (event: ChangeEvent<HTMLInputElement>) => void;
  handleDeleteImage: (imageId: string) => void;
};

/**
 * Custom hook for managing audit asset details dialog functionality.
 *
 * This hook orchestrates all data fetching and mutations for the audit asset
 * details dialog, providing a clean interface for the component.
 *
 * ## Responsibilities:
 * - Fetching notes and images for a specific audit asset
 * - Creating and deleting notes with optimistic UI updates
 * - Uploading and deleting images
 * - Managing all loading states
 * - Auto-refetching data after mutations complete
 *
 * ## Note: Audit Asset vs General Audit Notes
 * This hook works with asset-specific notes (AuditNote with auditAssetId set).
 * These are different from general audit session notes shown in the activity tab.
 *
 * @param auditSessionId - The ID of the audit session
 * @param auditAssetId - The ID of the audit asset (from AuditAsset table)
 * @param open - Whether the dialog is open (controls when data fetching is enabled)
 *
 * @returns Object containing state, handlers, and loading flags for the dialog
 */
export function useAuditAssetDetails({
  auditSessionId,
  auditAssetId,
  open,
}: UseAuditAssetDetailsParams): UseAuditAssetDetailsReturn {
  // Ref for hidden file input (triggered by image upload button)
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Ref for note form (used to reset after successful submission)
  const noteFormRef = useRef<HTMLFormElement>(null);

  // ========== Fetchers for Mutations ==========
  // Using separate fetchers for each mutation type prevents conflicts and
  // allows tracking individual loading states

  // Fetcher for creating notes - keyed to prevent duplicate simultaneous requests
  // Remove key to allow multiple concurrent submissions without abort signals
  const noteFetcher = useFetcher();

  // Fetcher for deleting notes
  const noteDeleteFetcher = useFetcher();

  // Fetcher for uploading images (used by quick camera button)
  const imageUploadFetcher = useFetcher();

  // Fetcher for image mutations (delete)
  const imageMutationFetcher = useFetcher();

  // ========== Data Fetching with useApiQuery ==========
  // These queries only run when the dialog is open to avoid unnecessary requests

  /**
   * Fetch notes specific to this audit asset.
   * API endpoint filters by auditSessionId AND auditAssetId.
   */
  const {
    data: notesData,
    isLoading: isLoadingNotes,
    refetch: refetchNotes,
  } = useApiQuery<{ notes: NoteData[] }>({
    api: `/api/audits/${auditSessionId}/assets/${auditAssetId}/notes`,
    enabled: open && !!auditAssetId,
  });

  /**
   * Fetch images specific to this audit asset.
   * API endpoint filters by auditSessionId AND auditAssetId.
   */
  const {
    data: imagesData,
    isLoading: isLoadingImages,
    refetch: refetchImages,
  } = useApiQuery<{ images: ImageData[] }>({
    api: `/api/audits/${auditSessionId}/assets/${auditAssetId}/images`,
    enabled: open && !!auditAssetId,
  });

  // Extract data arrays from API responses (with fallback to empty arrays)
  const images = imagesData?.images || [];

  // ========== Optimistic UI with React's useOptimistic Hook ==========
  /**
   * Use React's useOptimistic for proper multi-note optimistic handling.
   * This allows multiple notes to be submitted rapidly without conflicts.
   *
   * Pattern from: https://react.dev/reference/react/useOptimistic
   * - Optimistic updates are added immediately to the UI
   * - When server responds, optimistic updates are replaced with real data
   * - Multiple pending submissions are handled gracefully
   */
  const [optimisticNotes, addOptimisticNote] = useOptimistic(
    notesData?.notes || [],
    (state: NoteData[], newNote: NoteData) =>
      // Add new optimistic note at the beginning (newest first)
      [newNote, ...state]
  );

  // ========== Auto-Refetch Effects ==========
  // These effects watch for completed mutations and trigger data refresh.
  // This ensures the UI always shows the latest data after changes.

  /**
   * Refetch images after image deletion completes successfully.
   * Checks for idle state + successful payload before refetching.
   */
  useEffect(() => {
    if (
      imageMutationFetcher.state === "idle" &&
      imageMutationFetcher.data?.payload
    ) {
      refetchImages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageMutationFetcher.state, imageMutationFetcher.data]);

  /**
   * Refetch images after image upload completes successfully.
   * This shows the newly uploaded image in the dialog.
   */
  useEffect(() => {
    if (
      imageUploadFetcher.state === "idle" &&
      imageUploadFetcher.data?.payload
    ) {
      refetchImages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUploadFetcher.state, imageUploadFetcher.data]);

  /**
   * Refetch notes after note deletion completes successfully.
   * Removes the deleted note from the list.
   */
  useEffect(() => {
    if (noteDeleteFetcher.state === "idle" && noteDeleteFetcher.data?.payload) {
      refetchNotes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteDeleteFetcher.state, noteDeleteFetcher.data]);

  /**
   * Handle note creation completion.
   * Reset the form and re-enable submission.
   * The optimistic note will be replaced by the real note from the server.
   */
  useEffect(() => {
    if (noteFetcher.state === "idle") {
      // If we have data, it means submission was successful
      if (noteFetcher.data?.note) {
        // Refetch notes to get the real note from server
        refetchNotes();
        // Reset the form
        if (noteFormRef.current) {
          noteFormRef.current.reset();
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteFetcher.state, noteFetcher.data]);

  // ========== Mutation Handlers ==========

  /**
   * Handles note form submission with optimistic UI update.
   *
   * Following React's useOptimistic pattern:
   * 1. Add optimistic note immediately to UI
   * 2. Reset form
   * 3. Submit to server in a transition (prevents revalidation)
   * 4. When server responds, real note replaces optimistic one
   *
   * @param formData - Form data containing note content
   */
  const handleNoteFormAction = (formData: FormData) => {
    const content = formData.get("content") as string;
    if (!content?.trim()) return;

    // Add optimistic note immediately
    addOptimisticNote({
      id: `optimistic-${Date.now()}`,
      content,
      createdAt: new Date().toISOString(),
      userId: "",
      user: {
        id: "",
        firstName: "",
        lastName: "",
        email: "",
        profilePicture: null,
      },
    });

    // Reset form
    if (noteFormRef.current) {
      noteFormRef.current.reset();
    }

    // Submit to server in a transition to prevent revalidation
    startTransition(async () => {
      // Create a unique fetcher for this submission to prevent abort signals
      // Using native fetch to avoid abort signal conflicts
      await fetch(
        `/api/audits/${auditSessionId}/assets/${auditAssetId}/notes`,
        {
          method: "POST",
          body: formData,
        }
      );
      // Refetch notes to update UI with server response
      refetchNotes();
    });
  };

  /**
   * Handles file selection from the hidden input element.
   *
   * Called when user selects an image from their device or takes a photo.
   * Uploads the image immediately and resets the input for subsequent uploads.
   *
   * @param e - Change event from the file input
   */
  const handleFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("image", file);
    formData.append("auditAssetId", auditAssetId);

    void imageUploadFetcher.submit(formData, {
      method: "POST",
      action: `/api/audits/${auditSessionId}/upload-image`,
      encType: "multipart/form-data",
    });

    // Reset input so same file can be selected again if needed
    if (e.target) {
      e.target.value = "";
    }
  };

  /**
   * Triggers the hidden file input click to open native file picker/camera.
   * Used by both quick camera button and upload button in dialog.
   */
  const handleImageUpload = () => {
    fileInputRef.current?.click();
  };

  /**
   * Deletes an image after user confirmation.
   *
   * Shows browser confirm dialog before deletion. If confirmed,
   * sends delete request and removes image from gallery on success.
   *
   * @param imageId - The ID of the image to delete
   */
  const handleDeleteImage = (imageId: string) => {
    if (!confirm("Are you sure you want to delete this image?")) return;

    const formData = new FormData();
    formData.append("intent", "delete");
    formData.append("imageId", imageId);

    void imageMutationFetcher.submit(formData, {
      method: "POST",
      action: `/api/audits/${auditSessionId}/assets/${auditAssetId}/images`,
    });
  };

  // ========== Return Values ==========
  return {
    optimisticNotes,
    images,
    handleNoteFormAction,
    fileInputRef,
    noteFormRef,
    isLoadingNotes,
    isLoadingImages,
    isUploadingImage: imageUploadFetcher.state !== "idle",
    isMutatingImage: imageMutationFetcher.state !== "idle",
    noteFetcher,
    noteDeleteFetcher,
    handleFileSelected,
    handleImageUpload,
    handleDeleteImage,
  };
}
