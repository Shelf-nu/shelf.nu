/**
 * Drag-and-drop uploader for an asset's single PDF attachment (purchase
 * invoice, manual, calibration certificate, etc.).
 *
 * Owns two independent `useFetcher()` instances - one for upload, one for
 * delete - both posting to the dedicated `/api/asset/:assetId/attachment`
 * route, so a file can be added or removed instantly without touching the
 * rest of whatever form this is embedded in. That route branches
 * server-side on whether the asset already exists: for an existing asset it
 * persists directly to the DB and this component relies on React Router's
 * automatic loader revalidation to pick up the change; for an
 * asset that doesn't exist yet (the create-asset flow) the route only
 * touches storage, and this component surfaces the result via the
 * `onUploaded` / `onRemoved` callbacks so the caller can lift it into its
 * own form state and submit it once the rest of the form is ready.
 *
 * @see {@link file://../../../routes/api+/asset.$assetId.attachment.ts} for
 * the route and its existing-vs-staged branching.
 * @see {@link file://../../assets/form.tsx} (`AssetForm`) for the
 * create-flow caller that consumes `onUploaded` / `onRemoved`.
 */
import { useCallback, useEffect } from "react";
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
import { useDisabled } from "~/hooks/use-disabled";
import { ASSET_ATTACHMENT_MAX_SIZE } from "~/utils/constants";
import { isFormProcessing } from "~/utils/form";
import { formatBytes } from "~/utils/format-bytes";
import { FileDropzone } from "./file-dropzone";
import { TrashIcon } from "../../icons/library";

type StagedAttachment = {
  /** Raw storage path (see Asset.attachmentPath's schema comment). */
  attachmentPath: string;
  /** Short-lived signed URL for showing/linking to the file right now. */
  attachmentDisplayUrl: string;
  attachmentOriginalName: string | null;
  attachmentSize: number;
};

type AssetAttachmentUploadProps = {
  assetId: string;
  attachmentUrl?: string | null;
  attachmentOriginalName?: string | null;
  attachmentSize?: number | null;
  /**
   * Fires after a successful upload. The edit page doesn't need this - the
   * asset already exists, so `attachmentUrl` (a loader-data prop) refreshes
   * on its own via React Router's automatic revalidation after the fetcher
   * completes. The create-asset form has no loader-backed asset yet, so it
   * uses this to lift the staged attachment into its own form state and
   * carry it through as hidden fields on final submit.
   */
  onUploaded?: (attachment: StagedAttachment) => void;
  /** Same rationale as onUploaded, for the delete path. */
  onRemoved?: () => void;
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
  onUploaded,
  onRemoved,
}: AssetAttachmentUploadProps) {
  const uploadFetcher = useFetcher();
  const deleteFetcher = useFetcher();

  const isUploading = isFormProcessing(uploadFetcher.state);
  const isDeleting = isFormProcessing(deleteFetcher.state);
  // Also disabled while the enclosing form (edit-asset save, create-asset
  // submit) is navigating - it's a separate <Form> from this widget's own
  // fetchers, so isUploading/isDeleting alone miss that submission.
  const disabled = useDisabled() || isUploading || isDeleting;

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

  useEffect(() => {
    if (
      uploadFetcher.state === "idle" &&
      uploadFetcher.data &&
      !uploadFetcher.data.error
    ) {
      onUploaded?.({
        attachmentPath: uploadFetcher.data.attachmentPath,
        attachmentDisplayUrl: uploadFetcher.data.attachmentDisplayUrl,
        attachmentOriginalName: uploadFetcher.data.attachmentOriginalName,
        attachmentSize: uploadFetcher.data.attachmentSize,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadFetcher.state, uploadFetcher.data]);

  useEffect(() => {
    if (
      deleteFetcher.state === "idle" &&
      deleteFetcher.data &&
      !deleteFetcher.data.error
    ) {
      onRemoved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteFetcher.state, deleteFetcher.data]);

  // Both fetchers submit to a different route than the current page. For an
  // already-existing asset, React Router revalidates the current route's
  // loaders after any action by default, so `attachmentUrl` (a loader-data
  // prop) refreshes on its own - same as ProfilePictureUpload. A caller with
  // no loader-backed asset yet (the create-asset form) relies on onUploaded /
  // onRemoved above instead.
  if (attachmentUrl) {
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
              disabled={disabled}
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
                  <Button type="button" variant="secondary" disabled={disabled}>
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <deleteFetcher.Form
                  method="delete"
                  action={`/api/asset/${assetId}/attachment`}
                >
                  <Button
                    type="submit"
                    disabled={disabled}
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
