import type { ChangeEvent } from "react";
import { atom } from "jotai";
import {
  ASSET_MAX_IMAGE_UPLOAD_SIZE,
  DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
} from "~/utils/constants";
import { sanitizeFile } from "~/utils/sanitize-filename";
import { verifyAccept } from "~/utils/verify-file-accept";

export const fileErrorAtom = atom<string | undefined>(undefined);

/** Size + type limits and the copy shown when a file violates them. */
type ValidateFileOptions = {
  maxSize: number;
  sizeErrorMessage: string;
  allowedTypesErrorMessage: string;
};

/**
 * Validates the picked file and normalises the input in place.
 *
 * Clears the input on a rejected type or size (so an invalid file is never
 * submitted) and rewrites the `FileList` when the filename had to be sanitised
 * — a raw filename breaks the content-disposition header on upload.
 *
 * Pure with respect to state: it returns the message instead of writing it, so
 * the same rule can back both the shared and the scoped atoms below.
 *
 * @param event - Change event from the file input
 * @param options - Size/type limits and their messages
 * @returns The validation message, or undefined when the file is acceptable
 */
function validateSelectedFile(
  event: ChangeEvent<HTMLInputElement>,
  options: ValidateFileOptions
): string | undefined {
  const file = event?.target?.files?.[0];
  if (!file) {
    return undefined;
  }

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

  // Sanitize the filename to prevent content-disposition header issues
  if (event.target.files) {
    const sanitizedFile = sanitizeFile(file);

    // If the filename was changed, we need to update the file input
    if (sanitizedFile.name !== file.name) {
      // Create a new DataTransfer to replace the file in the input
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(sanitizedFile);
      event.target.files = dataTransfer.files;
    }
  }

  return undefined;
}

export const createValidateFileAtom = (options: ValidateFileOptions) =>
  atom(null, (_get, set, event: ChangeEvent<HTMLInputElement>) => {
    set(fileErrorAtom, () => validateSelectedFile(event, options));
  });

/**
 * Builds a validator with its OWN error atom, for file inputs that can be on
 * screen at the same time as another one.
 *
 * {@link fileErrorAtom} is module-scoped, so every consumer of
 * {@link createValidateFileAtom} shares one error slot. That is fine while only
 * one such form is mounted (asset, kit and audit forms never coexist), but the
 * inline "create asset model" dialog opens *inside* the asset form — with a
 * shared slot, rejecting a file in the dialog would also light up the asset's
 * own image field, and picking a valid one would clear an error the user still
 * needs to see.
 *
 * @param options - Same size/type limits as the shared factory
 * @returns `errorAtom` to read the message from, `validateAtom` to pass to `onChange`
 */
export const createScopedValidateFile = (options: ValidateFileOptions) => {
  const errorAtom = atom<string | undefined>(undefined);

  const validateAtom = atom(
    null,
    (_get, set, event: ChangeEvent<HTMLInputElement>) => {
      set(errorAtom, () => validateSelectedFile(event, options));
    }
  );

  return { errorAtom, validateAtom };
};

// Default instance with 4MB limit
export const defaultValidateFileAtom = createValidateFileAtom({
  maxSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE, // 4MB
  sizeErrorMessage: "Max file size is 4MB",
  allowedTypesErrorMessage: "Allowed file types are: PNG, JPG, JPEG, or WebP",
});

// For asset image uploads we allow 8MB
/**
 * Limits for asset-shaped image uploads. Shared by the asset image input and
 * the asset-model cover image so the two cannot drift — they accept the same
 * files and must reject them with the same copy.
 */
export const ASSET_IMAGE_VALIDATION = {
  maxSize: ASSET_MAX_IMAGE_UPLOAD_SIZE, // 8MB
  sizeErrorMessage: "Max file size is 8MB",
  allowedTypesErrorMessage: "Allowed file types are: PNG, JPG, JPEG, or WebP",
};

export const assetImageValidateFileAtom = createValidateFileAtom(
  ASSET_IMAGE_VALIDATION
);

// For audit image uploads we use the default 4MB limit
export const auditImageValidateFileAtom = createValidateFileAtom({
  maxSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE, // 4MB
  sizeErrorMessage: "Max file size is 4MB",
  allowedTypesErrorMessage: "Allowed file types are: PNG, JPG or JPEG",
});

/**
 * Asset-model cover image — same 8MB limit as asset images, but scoped, because
 * the inline create-model dialog is rendered inside the asset form and would
 * otherwise share its error slot.
 */
export const {
  errorAtom: assetModelImageErrorAtom,
  validateAtom: assetModelImageValidateFileAtom,
} = createScopedValidateFile(ASSET_IMAGE_VALIDATION);
