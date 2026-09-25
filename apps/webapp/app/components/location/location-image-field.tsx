/**
 * "Main image" field of the location form, with a picture of the location's
 * saved image next to the file input.
 *
 * The saved image renders the way the locations list renders it: the stored
 * thumbnail (falling back to the full image), or the placeholder for a
 * location without one, at the size every image form uses. Each upload is stored under a new path, so a replaced
 * image always comes with a new URL and needs no cache version.
 *
 * @see {@link file://./form.tsx} Location form (new and edit pages)
 * @see {@link file://../forms/image-file-field.tsx} Preview and validation
 */
import type { Location } from "@prisma/client";
import { ImageFileField } from "../forms/image-file-field";
import ImageWithPreview from "../image-with-preview/image-with-preview";

type LocationImageFieldProps = {
  /** Saved full-size image; omit for a new location. */
  imageUrl?: Location["imageUrl"];
  /** Saved thumbnail, preferred for the small picture. */
  thumbnailUrl?: Location["thumbnailUrl"];
  /** Error to show under the input (server or client validation). */
  error?: string;
  disabled?: boolean;
};

/**
 * Location image picture + "Main image" file input.
 *
 * @param props - See {@link LocationImageFieldProps}
 */
export function LocationImageField({
  imageUrl,
  thumbnailUrl,
  error,
  disabled,
}: LocationImageFieldProps) {
  return (
    <ImageFileField
      name="image"
      label="Main image"
      currentImage={
        <ImageWithPreview
          imageUrl={imageUrl ?? undefined}
          thumbnailUrl={thumbnailUrl}
          alt="Location image"
          className="size-16"
          // Opens the full image on click. Needs the full-size URL: without
          // it the preview trigger would be focusable but do nothing.
          withPreview={Boolean(imageUrl)}
        />
      }
      previewAlt="Location image"
      error={error}
      disabled={disabled}
    />
  );
}
