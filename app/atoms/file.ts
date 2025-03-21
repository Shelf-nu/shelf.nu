import type { ChangeEvent } from "react";
import { atom } from "jotai";
import { MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { verifyAccept } from "~/utils/verify-file-accept";

export const fileErrorAtom = atom<string | undefined>(undefined);

/** Validates the file atom */
export const validateFileAtom = atom(
  null,
  (_get, set, event: ChangeEvent<HTMLInputElement>) => {
    set(fileErrorAtom, () => {
      const file = event?.target?.files?.[0];
      if (file) {
        const allowedType = verifyAccept(file.type, event.target.accept);
        const allowedSize = file.size < MAX_IMAGE_UPLOAD_SIZE;

        if (!allowedType) {
          event.target.value = "";
          return `Allowed file types are: PNG, JPG or JPEG`;
        }

        if (!allowedSize) {
          /** Clean the field */
          event.target.value = "";
          return "Max file size is 8MB";
        }

        return undefined;
      }
    });
  }
);
