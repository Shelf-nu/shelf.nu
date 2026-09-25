/**
 * Image file field: the image upload row every entity form uses (asset, asset
 * model, kit, location, workspace, user profile).
 *
 * The row shows a picture next to the file input:
 * - the saved image (`currentImage`, rendered by the caller, because each
 *   entity stores and serves its images differently), and
 * - once the user picks a file, a local preview of that file instead, before
 *   anything is uploaded.
 *
 * A form without a saved image passes `currentImage={null}`: the picture
 * column only appears when a file is picked.
 *
 * Picked files go through the caller's validation atom (type and size limits,
 * see `~/atoms/file`). A rejected file is cleared from the input by that
 * validator, so the picture falls back to `currentImage` rather than
 * previewing a file that will not be uploaded.
 *
 * Layout: picture on the left; `aboveInput`, the size hint, the input and
 * `belowInput` on the right. The hint sits above the input on large screens
 * and below it on small ones. It is one element moved with CSS `order`, not
 * two copies: `aria-describedby` reads a referenced element even when it is
 * `display: none`, so a second copy would be announced twice.
 *
 * @see {@link file://./input.tsx} The underlying input
 * @see {@link file://../../atoms/file.ts} Validation atoms
 */
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import type { WritableAtom } from "jotai";
import { useSetAtom } from "jotai";
import { defaultValidateFileAtom } from "~/atoms/file";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { tw } from "~/utils/tw";
import Input from "./input";

/** Hint for the default 4 MB limit of {@link defaultValidateFileAtom}. */
export const IMAGE_HINT_4MB = "Accepts PNG, JPG, JPEG, or WebP (max.4 MB)";

/** Hint for the 8 MB limit of the asset, kit and asset-model validators. */
export const IMAGE_HINT_8MB = "Accepts PNG, JPG, JPEG, or WebP (max.8 MB)";

/** Size and shape of the picture, saved or previewed, unless overridden. */
export const IMAGE_FIELD_PICTURE_CLASSES =
  "size-16 rounded border object-cover";

/** A validation atom from `~/atoms/file`: takes the input's change event. */
type ValidateFileAtom = WritableAtom<
  null,
  [ChangeEvent<HTMLInputElement>],
  void
>;

type ImageFileFieldProps = {
  /** Form field name the action reads the file from. */
  name: string;
  /** Accessible label of the file input (visually hidden). */
  label: string;
  /**
   * Picture of the saved image, or `null` when there is none to show.
   * Shown whenever no valid file is picked.
   */
  currentImage: ReactNode | null;
  /** Alt text of the picked-file preview. */
  previewAlt: string;
  /**
   * Classes of the picked-file preview. Match the size and shape of
   * `currentImage` so the row does not shift when a file is picked.
   */
  previewClassName?: string;
  /** Validation to run on the picked file; defaults to the 4 MB rules. */
  validateFileAtom?: ValidateFileAtom;
  /** Size and format hint; must state the limit `validateFileAtom` applies. */
  hint?: ReactNode;
  /** Extra content above the hint and input (e.g. image source controls). */
  aboveInput?: ReactNode;
  /** Extra content below the input (e.g. where the image is used). */
  belowInput?: ReactNode;
  /** Error to show under the input (server or client validation). */
  error?: string;
  disabled?: boolean;
};

/**
 * File input with a picture of the saved image and a preview of a picked file.
 *
 * @param props - See {@link ImageFileFieldProps}
 */
export function ImageFileField({
  name,
  label,
  currentImage,
  previewAlt,
  previewClassName = IMAGE_FIELD_PICTURE_CLASSES,
  validateFileAtom = defaultValidateFileAtom,
  hint = IMAGE_HINT_4MB,
  aboveInput,
  belowInput,
  error,
  disabled,
}: ImageFileFieldProps) {
  const validateFile = useSetAtom(validateFileAtom);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const hintId = useId();

  // Each object URL pins its file in memory until revoked: release the old
  // one when the preview changes, and the last one on unmount.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  /**
   * Validates the picked file, then previews it, or falls back to the saved
   * image when the input ends up empty (a rejected file is cleared).
   *
   * @param event - Change event of the file input
   */
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    validateFile(event);
    // Read the file after validation: a rejected file has been cleared from
    // the input, and an accepted one may have been swapped for a copy with a
    // sanitised name.
    const file = event.target.files?.[0];
    setPreviewUrl(file ? URL.createObjectURL(file) : null);
  }

  const picture = previewUrl ? (
    <img src={previewUrl} alt={previewAlt} className={tw(previewClassName)} />
  ) : (
    currentImage
  );

  return (
    <div className="flex gap-3">
      {picture ? <div className="shrink-0">{picture}</div> : null}
      <div className="flex min-w-0 flex-col">
        {aboveInput}
        {/* DOM order is the large-screen order; small screens move the hint
            below the input. */}
        <div id={hintId} className="order-last mt-2 lg:order-none lg:mt-0">
          {hint}
        </div>
        <Input
          accept={ACCEPT_SUPPORTED_IMAGES}
          name={name}
          type="file"
          onChange={handleChange}
          label={label}
          hideLabel
          aria-describedby={hintId}
          error={error}
          disabled={disabled}
          className="mt-2"
          inputClassName="border-0 shadow-none p-0 rounded-none"
        />
        {belowInput ? <div className="order-last">{belowInput}</div> : null}
      </div>
    </div>
  );
}
