import type { ChangeEvent } from "react";
import { atom } from "jotai";
import {
  ASSET_MAX_IMAGE_UPLOAD_SIZE,
  DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
} from "~/utils/constants";
import { verifyAccept } from "~/utils/verify-file-accept";

export const fileErrorAtom = atom<string | undefined>(undefined);

export const createValidateFileAtom = (options: {
  maxSize: number;
  sizeErrorMessage: string;
  allowedTypesErrorMessage: string;
}) =>
  atom(null, (_get, set, event: ChangeEvent<HTMLInputElement>) => {
    set(fileErrorAtom, () => {
      const file = event?.target?.files?.[0];
      if (file) {
        const allowedType = verifyAccept(file.type, event.target.accept);
        const allowedSize = file.size < options.maxSize;

        if (!allowedType) {
          event.target.value = "";
          return options.allowedTypesErrorMessage;
        }

        if (!allowedSize) {
          /** Clean the field */
          event.target.value = "";
          return options.sizeErrorMessage;
        }

        return undefined;
      }
    });
  });

// Default instance with 4MB limit
export const defaultValidateFileAtom = createValidateFileAtom({
  maxSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE, // 4MB
  sizeErrorMessage: "Max file size is 4MB",
  allowedTypesErrorMessage: "Allowed file types are: PNG, JPG or JPEG",
});

// For asset image uploads we allow 8MB
export const assetImageValidateFileAtom = createValidateFileAtom({
  maxSize: ASSET_MAX_IMAGE_UPLOAD_SIZE, // 8MB
  sizeErrorMessage: "Max file size is 8MB",
  allowedTypesErrorMessage: "Allowed file types are: PNG, JPG or JPEG",
});
