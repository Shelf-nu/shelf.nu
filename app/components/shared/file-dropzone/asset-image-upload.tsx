// import { useCallback, useState } from "react";
// import { useFetcher } from "@remix-run/react";
// import { formatBytes } from "~/utils";
// import { FileDropzone } from "./file-dropzone";

export type FileInfo = {
  name: string;
  message: string;
} | null;

/** This is temporary not used */
export function AssetImageUpload() {
  return null;
  // const fetcher = useFetcher();
  // const [fileMeta, setFileMeta] = useState<FileInfo>(null);
  // const [temp, setTemp] = useState<string | ArrayBuffer | null>(null);

  // const onDropAccepted = useCallback(async (acceptedFiles: File[]) => {
  //   if (acceptedFiles) {
  //     /** embed the file on the dom */
  //     const f = acceptedFiles[0];
  //     const reader = new FileReader();
  //     reader.onload = function () {
  //       setTemp(reader.result);
  //     };
  //     reader.readAsDataURL(f);
  //     setFileMeta(() => ({
  //       name: f.name,
  //       message: formatBytes(f.size),
  //     }));
  //   }
  // }, []);

  // return (
  //   <div className="flex w-full gap-[20px]">
  //     <div className=" h-[128px] w-[128px]">
  //       <img
  //         className=" h-full object-contain"
  //         // @ts-ignore
  //         src={!temp ? "/static/images/item-placeholder.png" : temp}
  //         alt="Main "
  //       />
  //     </div>

  //     <FileDropzone
  //       onDropAccepted={onDropAccepted}
  //       fetcher={fetcher}
  //       fileInputName="mainImage"
  //       dropzoneOptions={{
  //         maxSize: 4_000_000,
  //       }}
  //     />
  //   </div>
  // );
}
