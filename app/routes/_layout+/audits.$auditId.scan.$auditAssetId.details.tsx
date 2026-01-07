import { useCallback, useEffect, useState, useRef } from "react";
import { MessageSquare, Paperclip } from "lucide-react";
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, useLoaderData, Form, useFetcher } from "react-router";
import { z } from "zod";
import {
  AuditAssetNoteItem,
  type NoteData,
} from "~/components/audit/audit-asset-note-item";
import {
  AuditImageUploadSection,
  type SelectedImage,
} from "~/components/audit/audit-image-upload-box";
import { AuditImageUploadDialog } from "~/components/audit/audit-image-upload-dialog";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { createAuditAssetImagesAddedNote } from "~/modules/audit/helpers.server";
import {
  uploadAuditImage,
  deleteAuditImage,
} from "~/modules/audit/image.service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId, auditAssetId } = getParams(
    params,
    z.object({ auditId: z.string(), auditAssetId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const permissionResult = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const { organizationId, isSelfServiceOrBase } = permissionResult;

    // Fetch audit asset with notes and images
    const auditAsset = await db.auditAsset.findFirst({
      where: {
        id: auditAssetId,
        auditSession: {
          organizationId,
        },
      },
      include: {
        asset: {
          select: {
            id: true,
            title: true,
          },
        },
        auditSession: {
          select: {
            assignments: {
              select: { userId: true },
            },
          },
        },
      },
    });

    if (!auditAsset) {
      throw new ShelfError({
        cause: null,
        message: "Audit asset not found",
        additionalData: { auditAssetId, organizationId },
        label: "Audit",
        status: 404,
      });
    }

    const { requireAuditAssigneeForBaseSelfService } = await import(
      "~/modules/audit/service.server"
    );
    requireAuditAssigneeForBaseSelfService({
      audit: auditAsset.auditSession,
      userId,
      isSelfServiceOrBase,
      auditId,
    });

    // Fetch notes for this audit asset
    const notes = await db.auditNote.findMany({
      where: {
        auditSessionId: auditId,
        auditAssetId: auditAssetId,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        userId: true,
        type: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profilePicture: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Fetch images
    const images = await db.auditImage.findMany({
      where: {
        auditAssetId: auditAssetId,
      },
      select: {
        id: true,
        imageUrl: true,
        thumbnailUrl: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const header = {
      title: auditAsset.asset.title,
      subHeading: "Notes and images",
    };

    return payload({
      showSidebar: true,
      header,
      auditAsset,
      notes,
      images,
      auditId,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId, auditAssetId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId, auditAssetId } = getParams(
    params,
    z.object({ auditId: z.string(), auditAssetId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const formData = await request.clone().formData();
    const intent = formData.get("intent") as string;

    if (intent === "create-note") {
      const content = formData.get("content") as string;

      if (!content?.trim()) {
        throw new ShelfError({
          cause: null,
          message: "Note content is required",
          additionalData: { auditAssetId },
          label: "Audit",
          status: 400,
        });
      }

      const note = await db.auditNote.create({
        data: {
          content: content.trim(),
          auditSessionId: auditId,
          auditAssetId: auditAssetId,
          userId,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profilePicture: true,
            },
          },
        },
      });

      return payload({ note });
    }

    if (intent === "delete-note") {
      const noteId = formData.get("noteId") as string;

      if (!noteId) {
        throw new ShelfError({
          cause: null,
          message: "Note ID is required",
          additionalData: { auditAssetId },
          label: "Audit",
          status: 400,
        });
      }

      // Prevent deletion of auto-generated notes (UPDATE type)
      const noteToDelete = await db.auditNote.findUnique({
        where: { id: noteId },
        select: { type: true },
      });

      if (noteToDelete?.type === "UPDATE") {
        throw new ShelfError({
          cause: null,
          message: "Cannot delete auto-generated notes",
          additionalData: { noteId },
          label: "Audit",
          status: 403,
        });
      }

      await db.auditNote.delete({
        where: {
          id: noteId,
        },
      });

      return payload({ success: true });
    }

    if (intent === "upload-image" || intent === "upload-images") {
      // Get optional note content
      const noteContent = formData.get("content") as string | null;

      // Get all files from the form data (already parsed above via clone)
      const fileEntries = formData.getAll(
        intent === "upload-images" ? "images" : "auditImage"
      );

      // Filter to only actual File objects
      const files = fileEntries.filter(
        (entry): entry is File => entry instanceof File
      );

      if (files.length === 0) {
        throw new ShelfError({
          cause: null,
          message: "No image files found in the request",
          additionalData: { auditAssetId },
          label: "Audit Image",
          status: 400,
        });
      }

      // Upload each file sequentially
      const uploadedImages: Array<{ id: string }> = [];
      for (const file of files) {
        // Create a new FormData with single file
        const singleFileFormData = new FormData();
        singleFileFormData.set("image", file);

        // Create a new Request with this FormData
        const singleFileRequest = new Request(request.url, {
          method: "POST",
          body: singleFileFormData,
        });

        const image = await uploadAuditImage({
          request: singleFileRequest,
          auditSessionId: auditId,
          organizationId,
          uploadedById: userId,
          auditAssetId: auditAssetId,
        });

        uploadedImages.push(image);
      }

      // Create a note in a transaction to track the image uploads
      await db.$transaction(async (tx) => {
        const imageIds = uploadedImages.map((img) => img.id);
        // Create note with custom content if provided, otherwise use default
        if (noteContent?.trim()) {
          // User provided a note - create a COMMENT note with images
          await tx.auditNote.create({
            data: {
              auditSessionId: auditId,
              auditAssetId: auditAssetId,
              userId,
              content: `${noteContent.trim()}\n\n{% audit_images count=${
                imageIds.length
              } ids="${imageIds.join(",")}" /%}`,
              type: "COMMENT",
            },
          });
        } else {
          // No note provided - use default auto-generated note
          await createAuditAssetImagesAddedNote({
            auditSessionId: auditId,
            auditAssetId: auditAssetId,
            userId,
            imageIds,
            tx,
          });
        }
      });

      return payload({ images: uploadedImages });
    }

    if (intent === "add-images-to-note") {
      const noteId = formData.get("noteId") as string;

      if (!noteId) {
        throw new ShelfError({
          cause: null,
          message: "Note ID is required to attach images",
          additionalData: { auditAssetId },
          label: "Audit Image",
          status: 400,
        });
      }

      // Get all files from the form data
      const fileEntries = formData.getAll("images");

      // Filter to only actual File objects
      const files = fileEntries.filter(
        (entry): entry is File => entry instanceof File
      );

      if (files.length === 0) {
        throw new ShelfError({
          cause: null,
          message: "No image files found in the request",
          additionalData: { auditAssetId },
          label: "Audit Image",
          status: 400,
        });
      }

      // Upload each file sequentially
      const uploadedImages: Array<{ id: string }> = [];
      for (const file of files) {
        // Create a new FormData with single file
        const singleFileFormData = new FormData();
        singleFileFormData.set("image", file);

        // Create a new Request with this FormData
        const singleFileRequest = new Request(request.url, {
          method: "POST",
          body: singleFileFormData,
        });

        const image = await uploadAuditImage({
          request: singleFileRequest,
          auditSessionId: auditId,
          organizationId,
          uploadedById: userId,
          auditAssetId: auditAssetId,
        });

        uploadedImages.push(image);
      }

      // Update the note to append the audit_images tag
      await db.$transaction(async (tx) => {
        const existingNote = await tx.auditNote.findUnique({
          where: { id: noteId },
        });

        if (!existingNote) {
          throw new ShelfError({
            cause: null,
            message: "Note not found",
            additionalData: { noteId },
            label: "Audit Image",
            status: 404,
          });
        }

        // Extract existing image IDs from content if any
        const existingImageIds: string[] = [];
        const regex = /{%\s*audit_images[^%]*ids="([^"]+)"[^%]*%}/g;
        let match;
        while ((match = regex.exec(existingNote.content)) !== null) {
          existingImageIds.push(...match[1].split(","));
        }

        // Add new image IDs
        const newImageIds = uploadedImages.map((img) => img.id);
        const allImageIds = [...existingImageIds, ...newImageIds];

        // Remove existing audit_images tags and append new one with all images
        let updatedContent = existingNote.content.replace(
          /{%\s*audit_images[^%]*%}/g,
          ""
        );
        updatedContent = updatedContent.trim();
        updatedContent += `\n\n{% audit_images count=${
          allImageIds.length
        } ids="${allImageIds.join(",")}" /%}`;

        await tx.auditNote.update({
          where: { id: noteId },
          data: {
            content: updatedContent,
          },
        });
      });

      return payload({ images: uploadedImages });
    }

    if (intent === "delete-image") {
      const imageId = formData.get("imageId") as string;

      if (!imageId) {
        throw new ShelfError({
          cause: null,
          message: "Image ID is required",
          additionalData: { auditAssetId },
          label: "Audit",
          status: 400,
        });
      }

      await deleteAuditImage({
        imageId,
        organizationId,
      });

      return payload({ success: true });
    }

    throw new ShelfError({
      cause: null,
      message: "Invalid intent",
      additionalData: { intent },
      label: "Audit",
      status: 400,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId, auditAssetId });
    return data(error(reason), { status: reason.status });
  }
}

export default function AuditAssetDetails() {
  const { notes: initialNotes, images } = useLoaderData<typeof loader>();

  const imageUploadFetcher = useFetcher<typeof action>();

  const [isUploadInProgress, setIsUploadInProgress] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [portalContainer, setPortalContainer] = useState<
    HTMLElement | undefined
  >();
  const [clearTrigger, setClearTrigger] = useState(0);
  const filePickerTriggerRef = useRef<
    ((currentSelectedCount?: number) => void) | null
  >(null);
  const imageRemovalRef = useRef<((id: string) => void) | null>(null);
  const [attachingToNoteId, setAttachingToNoteId] = useState<string | null>(
    null
  );

  // Set portal container on mount
  useEffect(() => {
    setPortalContainer(document.body);
  }, []);

  useEffect(() => {
    if (
      imageUploadFetcher.state === "submitting" ||
      imageUploadFetcher.state === "loading"
    ) {
      setIsUploadInProgress(true);
    } else if (imageUploadFetcher.state === "idle") {
      setIsUploadInProgress(false);
    }
  }, [imageUploadFetcher.state]);

  /**
   * Local state for notes - starts with server notes, gets temp notes added optimistically.
   * Each AuditAssetNoteItem handles its own server submission with unique fetcher.
   */
  const [localNotes, setLocalNotes] = useState<NoteData[]>([]);
  const [localImages, setLocalImages] = useState<typeof images>([]);

  // Sync local state with server data when revalidation happens
  useEffect(() => {
    setLocalNotes(
      initialNotes.map((note) => ({
        id: note.id,
        content: note.content,
        createdAt: note.createdAt,
        userId: note.userId ?? "",
        type: note.type,
        user: {
          id: note.user?.id ?? "",
          name:
            `${note.user?.firstName || ""} ${
              note.user?.lastName || ""
            }`.trim() ||
            note.user?.email ||
            "",
          img: note.user?.profilePicture ?? null,
        },
        needsServerSync: false,
      }))
    );
  }, [initialNotes]);

  // Sync local images with server data when loader runs
  useEffect(() => {
    setLocalImages(images);
  }, [images]);

  // Handle successful image upload from fetcher
  useEffect(() => {
    if (imageUploadFetcher.state === "idle" && imageUploadFetcher.data) {
      const data = imageUploadFetcher.data as any;
      if (data.images && Array.isArray(data.images)) {
        // Add newly uploaded images to local state, avoiding duplicates
        setLocalImages((prev) => {
          const existingIds = new Set(prev.map((img) => img.id));
          const newImages = data.images.filter(
            (img: any) => !existingIds.has(img.id)
          );
          return [...newImages, ...prev];
        });
      }
    }
  }, [imageUploadFetcher.state, imageUploadFetcher.data]);

  /**
   * Called when images are selected.
   * Opens the dialog to allow adding a note.
   */
  const handleImagesSelected = (images: SelectedImage[]) => {
    setSelectedImages(images);
    setDialogOpen(true);
  };

  /**
   * Called when images are selected while attaching to existing note.
   * The images parameter comes from handleImagesSelected callback.
   */
  useEffect(() => {
    // If we have attachingToNoteId and images were just selected, open dialog
    if (attachingToNoteId && selectedImages.length > 0 && !dialogOpen) {
      setDialogOpen(true);
    }
  }, [attachingToNoteId, selectedImages.length, dialogOpen]);

  /**
   * Handle removing an image from the selection
   */
  const handleRemoveImage = (id: string) => {
    setSelectedImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.previewUrl);
      }
      return prev.filter((img) => img.id !== id);
    });
    // Also remove from AuditImageUploadSection's local state
    if (imageRemovalRef.current) {
      imageRemovalRef.current(id);
    }
  };

  /**
   * Handle dialog close - cleanup preview URLs
   */
  const handleDialogClose = () => {
    setDialogOpen(false);
    setAttachingToNoteId(null);
    // Cleanup preview URLs
    selectedImages.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setSelectedImages([]);
    // Trigger cleanup in AuditImageUploadSection
    setClearTrigger((prev) => prev + 1);
  };

  /**
   * Called when "Add more" button is clicked in dialog.
   * Triggers the file picker from AuditImageUploadBox.
   */
  const handleAddMoreImages = () => {
    if (filePickerTriggerRef.current) {
      // Pass the current selected count + existing count to properly calculate remaining slots
      const totalCount = localImages.length + selectedImages.length;
      filePickerTriggerRef.current(totalCount);
    }
  };

  /**
   * Called by AuditAssetNoteItem when server returns real note data.
   * Replaces temp note with real note in local state.
   */
  const handleServerSync = useCallback((realNote: NoteData) => {
    setLocalNotes((prev) =>
      prev.map((note) =>
        // Replace temp note with real note
        note.needsServerSync && note.content === realNote.content
          ? realNote
          : note
      )
    );
  }, []);

  /**
   * Called by AuditAssetNoteItem when delete is clicked.
   * Removes note from local state immediately (optimistic).
   */
  const handleNoteDelete = useCallback((noteId: string) => {
    setLocalNotes((prev) => prev.filter((note) => note.id !== noteId));
  }, []);

  const handleAttachImages = useCallback(
    (noteId: string) => {
      setAttachingToNoteId(noteId);
      setSelectedImages([]);
      // Trigger file picker immediately when attaching to note
      if (filePickerTriggerRef.current) {
        filePickerTriggerRef.current(localImages.length);
      }
    },
    [localImages.length]
  );

  /**
   * Called when image delete is clicked.
   * Removes image from local state immediately (optimistic).
   */
  const handleImageDelete = (imageId: string) => {
    setLocalImages((prev) => prev.filter((img) => img.id !== imageId));
  };

  /**
   * Handle image delete with confirmation and Form submission.
   * This triggers the delete-image action which will revalidate.
   */
  const handleImageDeleteWithConfirm = (imageId: string) => {
    if (!confirm("Are you sure you want to delete this image?")) {
      return;
    }
    // Optimistic removal
    handleImageDelete(imageId);
    // Submit delete to server
    const formData = new FormData();
    formData.set("intent", "delete-image");
    formData.set("imageId", imageId);
    void fetch(window.location.href, {
      method: "POST",
      body: formData,
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Add note form */}
      <div className="shrink-0 border-b border-gray-200 px-6 py-4">
        <Form method="post">
          <input type="hidden" name="intent" value="create-note" />
          <div className="space-y-2">
            <textarea
              name="content"
              placeholder="Add a note..."
              rows={3}
              className="w-full resize-none rounded-md border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm">
                Add Note
              </Button>
            </div>
          </div>
        </Form>
      </div>

      {/* Notes section - scrollable, takes remaining space */}
      <div className="flex-1 overflow-y-auto border-b border-gray-200 px-6 py-4">
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            <MessageSquare className="size-5 text-gray-600" />
            <h3 className="text-base font-semibold text-gray-900">Notes</h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {localNotes.length}
            </span>
          </div>

          {localNotes.length === 0 ? (
            <p className="text-sm text-gray-500">No notes yet</p>
          ) : (
            <div className="space-y-3">
              {localNotes.map((note) => (
                <AuditAssetNoteItem
                  key={note.id}
                  note={note}
                  onServerSync={handleServerSync}
                  onDelete={handleNoteDelete}
                  onAttachImages={handleAttachImages}
                  currentImageCount={localImages.length}
                  maxImageCount={3}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Images section - fixed height at bottom */}
      <div className="h-68 shrink-0 overflow-y-auto  border-gray-200 px-6 py-4">
        <div className="mb-3 flex items-center gap-2">
          <Paperclip className="size-5 text-gray-600" />
          <h3 className="text-base font-semibold text-gray-900">Images</h3>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {localImages.length}
          </span>
        </div>

        {/* Upload section */}
        <AuditImageUploadSection
          maxCount={3}
          inputNamePrefix="auditImage"
          existingImages={localImages}
          onExistingImageRemove={handleImageDeleteWithConfirm}
          disabled={isUploadInProgress}
          isUploading={isUploadInProgress}
          onImagesSelected={handleImagesSelected}
          clearTrigger={clearTrigger}
          onExposeFilePicker={(trigger) => {
            filePickerTriggerRef.current = trigger;
          }}
          currentSelectedInDialog={selectedImages.length}
          onExposeImageRemoval={(removalFn) => {
            imageRemovalRef.current = removalFn;
          }}
        />
      </div>

      {/* Image upload dialog */}
      {dialogOpen && (
        <AuditImageUploadDialog
          open={dialogOpen}
          onClose={handleDialogClose}
          existingNoteId={attachingToNoteId}
          selectedImages={selectedImages}
          onRemoveImage={handleRemoveImage}
          onChangeImages={handleAddMoreImages}
          fetcher={imageUploadFetcher}
          portalContainer={portalContainer}
          maxCount={3}
          existingImagesCount={localImages.length}
        />
      )}
    </div>
  );
}
