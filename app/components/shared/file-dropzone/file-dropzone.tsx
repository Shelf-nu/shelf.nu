import { useCallback, useEffect, useMemo, useState } from "react";

import type { Fetcher } from "@remix-run/react";
import type { DropzoneOptions, FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import Input from "~/components/forms/input";

import { FileUploadIcon } from "~/components/icons/library";
import { formatBytes, tw } from "~/utils";
import type { FileInfo } from "./profile-picture-upload";

import { StatusMessage } from "./status-message";

export function FileDropzone({
  fetcher,
  onDropAccepted,
  dropzoneOptions,
  fileInfo,
  fileInputName,
}: // onDropRejected,
{
  fetcher: Fetcher;
  onDropAccepted: DropzoneOptions["onDropAccepted"];
  fileInfo: FileInfo;
  fileInputName: string;
  dropzoneOptions?: DropzoneOptions;
}) {
  const [filename, setFilename] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [dropzoneError, setDropzoneError] = useState<boolean>(false);

  const { type, data } = fetcher;
  const serverError = data?.error;

  const isPending = ["actionSubmission", "loaderSubmission"].includes(type);

  useEffect(() => {
    if (fileInfo) {
      setFilename(() => fileInfo.name);
      setMessage(() => fileInfo.message);
      setDropzoneError(() => false);
    }
  }, [fileInfo]);

  /**
   * THis effect takes care of the transitions of the states to manage
   * both serverside and clientside errors and messages.
   * Kinda jank, would love to improve this in the future */
  useEffect(() => {
    /** If there is a server error set is as the message */
    if (serverError) {
      setMessage(() => serverError);
    }

    return () => {
      /** Cleanup message */
      setMessage(() => "");
    };
  }, [serverError]);

  useEffect(() => {
    /** when the state is pending, that means we are between submissions so we set the state back to original state */
    if (type === "done") {
      setFilename(() => "");
      setMessage(() => "");
      setDropzoneError(() => false);
    }
  }, [type]);

  const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
    /** Set the status state needed to show the status message */
    setFilename(() => fileRejections?.[0]?.file?.name);
    setMessage(() => fileRejections?.[0]?.errors?.[0].message);
    setDropzoneError(() => true);
  }, []);

  const mergedDropzoneOptions = {
    onDropAccepted,
    onDropRejected,
    maxSize: 2_000_000,
    maxFiles: 1,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
    },
    ...dropzoneOptions,
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone(
    mergedDropzoneOptions
  );

  const style = useMemo(
    () =>
      tw(
        "flex min-w-[420px] flex-col items-center rounded-xl border-2 border-dashed border-gray-200 p-4", // default dropzone styles
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
    <div className="flex w-full max-w-[800px] flex-col gap-4">
      <div {...getRootProps({ className: style })}>
        <Input {...getInputProps()} disabled={isPending} name={fileInputName} />
        <FileUploadIcon />
        <p>
          <span className={fakeLinkStyles}>Click to upload</span> or drag and
          drop
        </p>
        <p>
          PNG, JPG or JPEG (max.{" "}
          {formatBytes(mergedDropzoneOptions?.maxSize as number)})
        </p>
      </div>
      <StatusMessage
        fetcher={fetcher}
        filename={filename}
        message={message}
        error={dropzoneError || serverError}
      />
    </div>
  );
}
