import { useCallback, useMemo, useState } from "react";

import { Form } from "@remix-run/react";
import type { FileRejection } from "react-dropzone";
import { useDropzone } from "react-dropzone";
import { FileUploadIcon } from "~/components/icons/library";
import { formatBytes, tw } from "~/utils";
import type { StatusMessageProps } from "./status-message";
import { StatusMessage } from "./status-message";

export function FileDropzone() {
  const [status, setStatus] = useState<StatusMessageProps>({
    filename: null,
    status: null,
    message: null,
  });

  const onDropAccepted = useCallback((acceptedFiles: File[]) => {
    // Do something with the files
    if (acceptedFiles) {
      /** We just support singular file upload so we get it like this */
      const { name, size } = acceptedFiles[0];
      /** if there are accepted files we can assume the user uploaded again so we clean up the errors */
      setStatus(() => ({
        filename: name,
        status: "pending",
        message: formatBytes(size),
      }));
    }
    console.log("acceptedFiles", acceptedFiles);
  }, []);

  const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
    // Do something with the files

    /** Set the status state needed to show the status message */
    setStatus(() => ({
      filename: fileRejections?.[0]?.file?.name,
      status: "error",
      message: fileRejections?.[0]?.errors?.[0].message,
    }));
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

  return (
    <div className="flex flex-col gap-4">
      <div {...getRootProps({ className: style })}>
        <Form className="flex flex-col items-center">
          <input {...getInputProps()} />
          <FileUploadIcon />
          <p>
            <span className="text-text-sm font-semibold text-primary-700">
              Click to upload
            </span>{" "}
            or drag and drop
          </p>
          <p>PNG, JPG or JPEG (max. 400x400px, max. 2MB)</p>
        </Form>
      </div>
      {status?.message ? <StatusMessage {...status} /> : null}
    </div>
  );
}
