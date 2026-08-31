import { useCallback } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { ASSET_ATTACHMENT_MAX_SIZE } from "~/utils/constants";
import { isFormProcessing } from "~/utils/form";
import { formatBytes } from "~/utils/format-bytes";
import { FileDropzone } from "./file-dropzone";
import { TrashIcon } from "../../icons/library";

type AssetAttachmentUploadProps = {
  assetId: string;
  attachmentUrl?: string | null;
  attachmentOriginalName?: string | null;
  attachmentSize?: number | null;
};

/**
 * Drag-and-drop upload for an asset's single PDF attachment (purchase
 * invoice, manual, calibration certificate, etc. - issue #2660). Own
 * fetchers/route so upload and delete happen instantly, independent of the
 * rest of the edit-asset form.
 */
export function AssetAttachmentUpload({
  assetId,
  attachmentUrl,
  attachmentOriginalName,
  attachmentSize,
}: AssetAttachmentUploadProps) {
  const uploadFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  const isUploading = isFormProcessing(uploadFetcher.state);
  const isDeleting = isFormProcessing(deleteFetcher.state);

  const onDropAccepted = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) {
        return;
      }
      // fetcher.submit({ file }, { encType: "multipart/form-data" }) does not
      // encode a File value nested in a plain object - it gets coerced to the
      // string "[object File]" before the request body is built. Building the
      // FormData explicitly sidesteps that.
      const formData = new FormData();
      formData.append("file", file);
      void uploadFetcher.submit(formData, {
        method: "post",
        action: `/api/asset/${assetId}/attachment`,
        encType: "multipart/form-data",
      });
    },
    [assetId, uploadFetcher]
  );

  // Both fetchers submit to a different route than the current page, but
  // React Router revalidates the current route's loaders after any action
  // by default - so `attachmentUrl` (a loader-data prop) refreshes on its
  // own once upload/delete completes, same as ProfilePictureUpload.
  if (attachmentUrl && !isDeleting) {
    return (
      <div className="flex items-center gap-3">
        <a
          href={attachmentUrl}
          target="_blank"
          rel="noreferrer"
          className="text-text-sm font-semibold text-primary-700 hover:text-primary-800"
        >
          {attachmentOriginalName || "Attachment.pdf"}
        </a>
        {attachmentSize ? (
          <span className="text-text-sm text-gray-500">
            {formatBytes(attachmentSize)}
          </span>
        ) : null}

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isUploading || isDeleting}
              title="Delete attachment"
            >
              <TrashIcon />
            </Button>
          </AlertDialogTrigger>

          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="mx-auto md:m-0">
                <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
                  <TrashIcon />
                </span>
              </div>
              <AlertDialogTitle>Delete attachment</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete{" "}
                {attachmentOriginalName || "this attachment"}? This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <div className="flex justify-center gap-2">
                <AlertDialogCancel asChild>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isDeleting}
                  >
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <deleteFetcher.Form
                  method="delete"
                  action={`/api/asset/${assetId}/attachment`}
                >
                  <Button
                    type="submit"
                    disabled={isDeleting}
                    className="border-error-600 bg-error-600 hover:border-error-800 hover:!bg-error-800"
                  >
                    Delete
                  </Button>
                </deleteFetcher.Form>
              </div>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <FileDropzone
      fetcher={uploadFetcher}
      onDropAccepted={onDropAccepted}
      fileInputName="file"
      acceptLabel="PDF"
      dropzoneOptions={{
        maxSize: ASSET_ATTACHMENT_MAX_SIZE,
        maxFiles: 1,
        accept: { "application/pdf": [".pdf"] },
      }}
    />
  );
}
