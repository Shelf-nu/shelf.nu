import { atom } from "jotai";
import { formatBytes } from "~/utils/format-bytes";

export type FileInfo = {
  filename: string;
  message: string;
  error?: boolean;
};

export const fileInfoAtom = atom<FileInfo>({
  filename: "",
  message: "",
  error: false,
});

export const derivedFileInfoAtom = atom(
  (get) => get(fileInfoAtom),
  (_get, set, fileInfo: FileInfo) => {
    if (fileInfo) {
      set(fileInfoAtom, {
        filename: fileInfo.filename,
        message: fileInfo.message,
        error: fileInfo.error || false,
      });
    }
  }
);

/** Used when uploading. Its done in a seperate atom so we can seperate the logic */
export const updateFileInfoFromFileAtom = atom(
  (get) => get(derivedFileInfoAtom),
  (_get, set, file: File) => {
    const { name, size } = file;
    set(derivedFileInfoAtom, {
      filename: name,
      message: formatBytes(size),
    });
  }
);
