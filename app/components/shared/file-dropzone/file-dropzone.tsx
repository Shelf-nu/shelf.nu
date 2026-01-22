import { useCallback, useEffect, useMemo } from "react";

import { useAtom } from "jotai";
import type { DropzoneOptions, FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import type { Fetcher } from "react-router";

import { FileUploadIcon } from "~/components/icons/library";
import { isFormProcessing } from "~/utils/form";
import { formatBytes } from "~/utils/format-bytes";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { derivedFileInfoAtom } from "./atoms";

import { StatusMessage } from "./status-message";

export function FileDropzone({
  fetcher,
  onDropAccepted,
  dropzoneOptions,
  fileInputName,
  className,
}: {
  fetcher: Fetcher;
  onDropAccepted: DropzoneOptions["onDropAccepted"];
  fileInputName: string;
  dropzoneOptions?: DropzoneOptions;
  className?: string;
}) {
  const [fileInfo, updateAllFileInfo] = useAtom(derivedFileInfoAtom);
  const { filename, message, error } = fileInfo;

  const { data } = fetcher as Fetcher<DataOrErrorResponse>;
  const serverError = data?.error?.message;

  const isPending = isFormProcessing(fetcher.state);

  /**
   * THis effect takes care of the transitions of the states to manage
   * both serverside and clientside errors and messages.
   * Kinda jank, would love to improve this in the future */
  useEffect(() => {
    /** If there is a server error set is as the message */
    if (serverError) {
      updateAllFileInfo({
        filename,
        message: serverError,
        error: true,
      });
    }

    return () => {
      /** Cleanup message */
      updateAllFileInfo({
        ...fileInfo,
        message: "",
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverError, updateAllFileInfo]);

  const onDropRejected = useCallback(
    (fileRejections: FileRejection[]) => {
      /** Set the status state needed to show the status message */
      updateAllFileInfo({
        filename: fileRejections?.[0]?.file?.name,
        message: fileRejections?.[0]?.errors?.[0].message,
        error: true,
      });
    },
    [updateAllFileInfo]
  );

  const mergedDropzoneOptions = {
    onDropAccepted,
    onDropRejected,
    maxSize: 2_000_000,
    maxFiles: 1,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
    },
    ...dropzoneOptions,
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone(
    mergedDropzoneOptions
  );

  const style = useMemo(
    () =>
      tw(
        "flex flex-col items-center rounded-xl border-2 border-dashed border-gray-200 p-4", // default dropzone styles
        isDragActive && "border-solid border-primary bg-gray-50" // classes added when draggin item on top
      ),
    [isDragActive]
  );

  const fakeLinkStyles = useMemo(
    () =>
      tw(
        "text-text-sm font-semibold  text-primary-700 hover:cursor-pointer hover:text-primary-800", // base
        isPending &&
          "border-gray-200 bg-gray-50 text-gray-300 hover:pointer-events-none" // disabled state
      ),
    [isPending]
  );

  return (
    <div className={tw("flex max-w-full grow flex-col gap-4", className)}>
      <div {...getRootProps({ className: style })}>
        <input {...getInputProps()} disabled={isPending} name={fileInputName} />
        <FileUploadIcon />
        <p>
          <span className={fakeLinkStyles}>Click to upload</span> or drag and
          drop
        </p>
        <p>
          PNG, JPG, JPEG, or WebP (max.{" "}
          {formatBytes(mergedDropzoneOptions?.maxSize as number)})
        </p>
      </div>
      <StatusMessage
        fetcher={fetcher}
        filename={filename}
        message={message}
        error={error || !!serverError}
      />
    </div>
  );
}
