import { useCallback, useEffect, useMemo, useState } from "react";

import { Form, useFetcher } from "@remix-run/react";
import type { FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import { FileUploadIcon } from "~/components/icons/library";
import { formatBytes, tw } from "~/utils";
import { StatusMessage } from "./status-message";

export function FileDropzone() {
  const fetcher = useFetcher();
  const [filename, setFilename] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [dropzoneError, setDropzoneError] = useState<boolean>(false);

  const { type, data } = fetcher;
  const serverError = data?.error;

  const isPending = ["actionSubmission", "loaderSubmission"].includes(type);

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
    if (isPending) {
      setFilename(() => "");
      setMessage(() => "");
      setDropzoneError(() => false);
    }

    return () => {
      /** Cleanup everything */
      setFilename(() => "");
      setMessage(() => "");
      setDropzoneError(() => false);
    };
  }, [isPending]);

  const onDropAccepted = useCallback(
    async (acceptedFiles: File[]) => {
      // Do something with the files
      if (acceptedFiles) {
        const { name, size } = acceptedFiles[0];

        fetcher.submit(
          /**
           * For some reason even tho its multipart/form-data submit() is not
           *  happy with me passing a file as part of the POST body
           @ts-ignore */
          { file: acceptedFiles[0] },
          {
            method: "post",
            action: "/api/user/upload-user-photo",
            encType: "multipart/form-data",
          }
        );

        /** We just support singular file upload so we get it like this */
        /** if there are accepted files we can assume the user uploaded again so we clean up the errors */
        setFilename(() => name);
        setMessage(() => formatBytes(size));
        setDropzoneError(() => false);
      }
    },
    [fetcher]
  );

  const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
    /** Set the status state needed to show the status message */
    setFilename(() => fileRejections?.[0]?.file?.name);
    setMessage(() => fileRejections?.[0]?.errors?.[0].message);
    setDropzoneError(() => true);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted,
    onDropRejected,
    maxSize: 2e6,
    maxFiles: 1,
    accept: {
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
    },
  });

  const style = useMemo(
    () =>
      tw(
        "min-w-[420px] rounded-xl border-2 border-dashed border-gray-200 p-4", // default dropzone styles
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
        <Form className="flex flex-col items-center">
          <input
            {...getInputProps()}
            disabled={isPending}
            name="profile-picture"
          />
          <FileUploadIcon />
          <p>
            <span className={fakeLinkStyles}>Click to upload</span> or drag and
            drop
          </p>
          <p>PNG, JPG or JPEG (max. 2MB)</p>
        </Form>
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
