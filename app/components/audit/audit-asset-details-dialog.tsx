import type { AuditAsset } from "@prisma/client";
import { X, Loader2, Trash } from "lucide-react";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "~/components/shared/sheet";
import { Skeleton } from "~/components/shared/skeleton";
import {
  useAuditAssetDetails,
  type NoteData,
  type ImageData,
} from "~/hooks/use-audit-asset-details";
import { tw } from "~/utils/tw";

type AuditAssetDetailsDialogProps = {
  open: boolean;
  onClose: () => void;
  auditAssetId: AuditAsset["id"];
  auditSessionId: string;
  assetName: string;
};

/**
 * Dialog for managing notes and images for a specific asset in an audit.
 * Shows notes and images in a single scrollable view.
 */
export function AuditAssetDetailsDialog({
  open,
  onClose,
  auditAssetId,
  auditSessionId,
  assetName,
}: AuditAssetDetailsDialogProps) {
  const {
    notes,
    images,
    optimisticNote,
    fileInputRef,
    noteFormRef,
    isLoadingNotes,
    isLoadingImages,
    isSubmittingNote,
    isUploadingImage,
    isMutatingImage,
    noteFetcher,
    noteDeleteFetcher,
    handleSubmitNote,
    handleFileSelected,
    handleImageUpload,
    handleDeleteImage,
  } = useAuditAssetDetails({
    auditSessionId,
    auditAssetId,
    open,
  });

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent className="w-full overflow-y-auto bg-white sm:max-w-lg">
        <div className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>Asset Details: {assetName}</SheetTitle>
          </SheetHeader>

          <div className="mt-6 flex-1 space-y-6">
            {/* Notes Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900">Notes</h4>
              <noteFetcher.Form
                ref={noteFormRef}
                method="post"
                action={`/api/audits/${auditSessionId}/assets/${auditAssetId}/notes`}
                onSubmit={handleSubmitNote}
              >
                <input type="hidden" name="intent" value="create" />
                <textarea
                  name="content"
                  placeholder="Add a note about this asset..."
                  className="min-h-[80px] w-full rounded-md border border-gray-300 p-2 text-sm focus:border-gray-500 focus:outline-none"
                  disabled={isSubmittingNote}
                />
                <Button
                  type="submit"
                  disabled={isSubmittingNote}
                  className="mt-2"
                >
                  {isSubmittingNote ? "Adding..." : "Add Note"}
                </Button>
              </noteFetcher.Form>

              {isLoadingNotes ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="rounded-md border border-gray-200 bg-gray-50 p-3"
                    >
                      <Skeleton className="mb-2 h-4 w-3/4 bg-gray-300" />
                      <Skeleton className="h-3 w-1/4 bg-gray-300" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {/* Show optimistic note while submitting */}
                  {optimisticNote && (
                    <div
                      key="optimistic-note"
                      className="rounded-md border border-gray-200 bg-gray-50 p-3 opacity-60"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm text-gray-900">
                            {optimisticNote.content}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                            <span>
                              {optimisticNote.user.firstName}{" "}
                              {optimisticNote.user.lastName}
                            </span>
                            <span>•</span>
                            <DateS
                              date={optimisticNote.createdAt}
                              includeTime
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Render existing notes */}
                  {notes.map((note: NoteData) => (
                    <div
                      key={note.id}
                      className="rounded-md border border-gray-200 bg-gray-50 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm text-gray-900">
                            {note.content}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                            <span>
                              {note.user.firstName} {note.user.lastName}
                            </span>
                            <span>•</span>
                            <DateS date={note.createdAt} includeTime />
                          </div>
                        </div>
                        <noteDeleteFetcher.Form
                          method="post"
                          action={`/api/audits/${auditSessionId}/assets/${auditAssetId}/notes`}
                          onSubmit={(e) => {
                            if (
                              !confirm(
                                "Are you sure you want to delete this note?"
                              )
                            ) {
                              e.preventDefault();
                            }
                          }}
                        >
                          <input type="hidden" name="intent" value="delete" />
                          <input type="hidden" name="noteId" value={note.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="xs"
                            className="text-gray-400 hover:text-red-600"
                          >
                            <Trash className="size-4" />
                          </Button>
                        </noteDeleteFetcher.Form>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Images Section */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-gray-900">Images</h4>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelected}
              />
              {isLoadingImages ? (
                <div className="flex flex-wrap gap-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton
                      key={i}
                      className="size-24 rounded-md bg-gray-300"
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {/* Upload button */}
                  <button
                    type="button"
                    onClick={handleImageUpload}
                    disabled={isUploadingImage || images.length >= 3}
                    className={tw(
                      "flex size-24 items-center justify-center rounded-md border-2 border-dashed bg-gray-50 text-gray-400",
                      images.length >= 3
                        ? "cursor-not-allowed border-gray-200 opacity-50"
                        : "border-gray-300 hover:border-gray-400 hover:bg-gray-100"
                    )}
                  >
                    {isUploadingImage ? (
                      <Loader2
                        className="size-6"
                        style={{ animation: "spinner 0.6s linear infinite" }}
                      />
                    ) : (
                      <span className="text-2xl">+</span>
                    )}
                  </button>

                  {/* Image thumbnails */}
                  {images.map((image: ImageData) => (
                    <div key={image.id} className="group relative size-24">
                      <ImageWithPreview
                        thumbnailUrl={image.thumbnailUrl}
                        imageUrl={image.imageUrl}
                        withPreview={true}
                        alt="Audit asset image"
                        className="size-24 rounded-md object-cover"
                      />
                      {/* Delete button overlay */}
                      <button
                        type="button"
                        onClick={() => handleDeleteImage(image.id)}
                        disabled={isMutatingImage}
                        className="absolute right-1 top-1 rounded-full bg-red-600 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-700"
                      >
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-xs text-gray-500">
                {images.length >= 3
                  ? "Maximum 3 images reached for this asset."
                  : "Click thumbnails to view full size. Max 3 images per asset."}
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
