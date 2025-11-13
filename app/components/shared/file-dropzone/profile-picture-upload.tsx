import { useCallback } from "react";
import { useAtom } from "jotai";
import { useFetcher } from "react-router";
import { updateFileInfoFromFileAtom } from "./atoms";
import { FileDropzone } from "./file-dropzone";

export function ProfilePictureUpload() {
  const fetcher = useFetcher();
  const [, setFileInfo] = useAtom(updateFileInfoFromFileAtom);

  const onDropAccepted = useCallback(
    (acceptedFiles: File[]) => {
      // Do something with the files
      if (acceptedFiles) {
        const file = acceptedFiles[0];
        setFileInfo(file);
        fetcher.submit(
          /**
           * For some reason even tho its multipart/form-data submit() is not
           *  happy with me passing a file as part of the POST body
           @ts-ignore */
          { file },
          {
            method: "post",
            action: "/api/user/prefs/upload-user-photo",
            encType: "multipart/form-data",
          }
        );
      }
    },
    [fetcher, setFileInfo]
  );

  return (
    <FileDropzone
      onDropAccepted={onDropAccepted}
      dropzoneOptions={{
        maxSize: 2_000_000,
        maxFiles: 1,
        accept: {
          "image/png": [".png"],
          "image/jpeg": [".jpg", ".jpeg"],
        },
      }}
      fetcher={fetcher}
      fileInputName="profile-picture"
    />
  );
}
