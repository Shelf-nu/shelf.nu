import type React from "react";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Paperclip } from "lucide-react";
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { data, useLoaderData, Form, useFetcher } from "react-router";
import { z } from "zod";
import {
  AuditAssetNoteItem,
  type NoteData,
} from "~/components/audit/audit-asset-note-item";
import { AuditImageUploadSection } from "~/components/audit/audit-image-upload-box";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useUserData } from "~/hooks/use-user-data";
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
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

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

    // Fetch notes for this audit asset
    const notes = await db.auditNote.findMany({
      where: {
        auditSessionId: auditId,
        auditAssetId: auditAssetId,
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

/**
 * Revalidate on errors to refresh UI after failed operations.
 * Skip revalidation on successful image uploads to prevent flashing.
 */
export function shouldRevalidate({
  formAction,
  actionStatus,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  if (formAction?.includes("intent=upload-image") && actionStatus === 200) {
    return false;
  }
  return defaultShouldRevalidate;
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

      await db.auditNote.delete({
        where: {
          id: noteId,
        },
      });

      return payload({ success: true });
    }

    if (intent === "upload-image") {
      // Get all files from the form data (already parsed above via clone)
      const fileEntries = formData.getAll("auditImage");

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
      const uploadedImages = [];
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
  const user = useUserData();
  const formRef = useRef<HTMLFormElement>(null);
  const imageFormRef = useRef<HTMLFormElement>(null);

  const imageUploadFetcher = useFetcher<typeof action>();

  const [isUploadInProgress, setIsUploadInProgress] = useState(false);

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
   * Auto-submit the image upload form when new images are added
   */
  const handleImagesAdded = () => {
    if (imageFormRef.current) {
      const formData = new FormData(imageFormRef.current);
      void imageUploadFetcher.submit(formData, {
        method: "POST",
        encType: "multipart/form-data",
      });
    }
  };

  const handleNoteFormAction = (formData: FormData) => {
    const content = formData.get("content") as string;

    if (!content?.trim()) return;

    // Create temp note with needsServerSync flag
    const tempNote: NoteData = {
      id: `temp-${Date.now()}`,
      content: content.trim(),
      createdAt: new Date().toISOString(),
      userId: user!.id,
      user: {
        id: user!.id,
        name:
          `${user!.firstName || ""} ${user!.lastName || ""}`.trim() ||
          user!.email,
        img: user!.profilePicture || null,
      },
      needsServerSync: true, // Triggers AuditAssetNoteItem to submit to server
    };

    // Add temp note to local state immediately (optimistic UI)
    setLocalNotes((prev) => [tempNote, ...prev]);
    formRef.current?.reset();
  };

  /**
   * Called by AuditAssetNoteItem when server returns real note data.
   * Replaces temp note with real note in local state.
   */
  const handleServerSync = (realNote: NoteData) => {
    setLocalNotes((prev) =>
      prev.map((note) =>
        // Replace temp note with real note
        note.needsServerSync && note.content === realNote.content
          ? realNote
          : note
      )
    );
  };

  /**
   * Called by AuditAssetNoteItem when delete is clicked.
   * Removes note from local state immediately (optimistic).
   */
  const handleNoteDelete = (noteId: string) => {
    setLocalNotes((prev) => prev.filter((note) => note.id !== noteId));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

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
        <Form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            handleNoteFormAction(formData);
          }}
        >
          <input type="hidden" name="intent" value="create-note" />
          <div className="space-y-2">
            <textarea
              name="content"
              placeholder="Add a note... (Cmd/Ctrl+Enter to submit)"
              rows={3}
              className="w-full resize-none rounded-md border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
              onKeyDown={handleKeyDown}
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
        <imageUploadFetcher.Form
          method="post"
          encType="multipart/form-data"
          ref={imageFormRef}
        >
          <input type="hidden" name="intent" value="upload-image" />
          <AuditImageUploadSection
            maxCount={3}
            inputNamePrefix="auditImage"
            existingImages={localImages}
            onExistingImageRemove={handleImageDeleteWithConfirm}
            disabled={isUploadInProgress}
            isUploading={isUploadInProgress}
            onImagesAdded={handleImagesAdded}
          />
        </imageUploadFetcher.Form>
      </div>
    </div>
  );
}
