import { useCallback, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { formatBytes } from "~/utils";
import { FileDropzone } from "./file-dropzone";

export type FileInfo = {
  name: string;
  message: string;
} | null;

export function ProfilePictureUpload() {
  const fetcher = useFetcher();
  const [fileInfo, setFileInfo] = useState<FileInfo>(null);

  const onDropAccepted = useCallback(
    async (acceptedFiles: File[]) => {
      // Do something with the files
      if (acceptedFiles) {
        const { name, size } = acceptedFiles[0];
        setFileInfo(() => ({
          name,
          message: formatBytes(size),
        }));

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
      }
    },
    [fetcher]
  );

  return (
    <FileDropzone
      onDropAccepted={onDropAccepted}
      fetcher={fetcher}
      fileInfo={fileInfo}
      fileInputName="profile-picture"
    />
  );
}
