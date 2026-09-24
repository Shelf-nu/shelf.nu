/**
 * Image file field: a form's image file input with a picture beside it.
 *
 * The picture is the image already saved (`currentImage`, rendered by the
 * caller) until the user picks a file; then it becomes a local preview of
 * that file, before anything is uploaded. Callers keep their own field name,
 * so the form's action reads the upload exactly as it would from a bare
 * input.
 *
 * Picked files go through the shared {@link defaultValidateFileAtom} rules
 * (type + 4 MB). That validator clears a rejected file from the input, so the
 * picture falls back to `currentImage` rather than previewing a file that
 * will not be uploaded.
 *
 * Layout: picture on the left; hint + input on the right. The hint sits above
 * the input on large screens and below it on small ones. It is one element
 * moved with CSS `order`, not two copies: `aria-describedby` reads a
 * referenced element even when it is `display: none`, so a second copy would
 * be announced twice.
 *
 * @see {@link file://./input.tsx} The underlying input
 * @see {@link file://../../atoms/file.ts} Validation rules
 */
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { useSetAtom } from "jotai";
import { defaultValidateFileAtom } from "~/atoms/file";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { tw } from "~/utils/tw";
import Input from "./input";

const HINT = "Accepts PNG, JPG, JPEG, or WebP (max.4 MB)";

type ImageFileFieldProps = {
  /** Form field name the action reads the file from. */
  name: string;
  /** Accessible label of the file input (visually hidden). */
  label: string;
  /**
   * Picture of the saved image, or of the placeholder when there is none.
   * Shown whenever no valid file is picked.
   */
  currentImage: ReactNode;
  /** Alt text of the picked-file preview. */
  previewAlt: string;
  /**
   * Classes of the picked-file preview. Match the size and shape of
   * `currentImage` so the row does not shift when a file is picked.
   */
  previewClassName?: string;
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
  previewClassName = "size-12 rounded-[4px] object-cover",
  error,
  disabled,
}: ImageFileFieldProps) {
  const validateFile = useSetAtom(defaultValidateFileAtom);
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

  return (
    <div className="flex gap-3">
      <div className="shrink-0">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={previewAlt}
            className={tw(previewClassName)}
          />
        ) : (
          currentImage
        )}
      </div>
      <div className="flex min-w-0 flex-col">
        <p id={hintId} className="order-last mt-2 lg:order-first lg:mt-0">
          {HINT}
        </p>
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
      </div>
    </div>
  );
}
