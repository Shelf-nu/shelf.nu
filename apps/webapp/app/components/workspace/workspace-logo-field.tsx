/**
 * "Main image" field of the workspace forms, with a picture of the
 * workspace's stored logo next to the file input.
 *
 * The picture is always the stored logo (or the placeholder when there is
 * none), for every workspace type. The logo is what the booking, receipt,
 * audit and report PDFs print, including on a PERSONAL workspace, so this row
 * must show that image even though the sidebar shows a personal workspace as
 * its owner's profile picture.
 *
 * Picking a file previews it in place of that picture; validation and the
 * preview itself live in the shared {@link ImageFileField}.
 *
 * @see {@link file://./edit-form.tsx} Workspace settings form (saved logo)
 * @see {@link file://./form.tsx} New-workspace form (placeholder, preview)
 * @see {@link file://../forms/image-file-field.tsx} Preview and validation
 * @see {@link file://../shared/image.tsx} Versioned `/api/image` URL contract
 */
import {
  IMAGE_FIELD_PICTURE_CLASSES,
  ImageFileField,
} from "../forms/image-file-field";
import { Image } from "../shared/image";

type WorkspaceLogoFieldProps = {
  /** Stored logo of the workspace; omit when there is none yet. */
  imageId?: string | null;
  /**
   * The workspace's `updatedAt`. Becomes the `?v=` version of the logo URL,
   * which `/api/image` needs to serve a replaced logo instead of a cached one.
   */
  updatedAt?: Date | string;
  /** Error to show under the input (server or client validation). */
  error?: string;
};

/**
 * Logo picture + "Main image" file input for the workspace forms.
 *
 * @param props - See {@link WorkspaceLogoFieldProps}
 */
export function WorkspaceLogoField({
  imageId,
  updatedAt,
  error,
}: WorkspaceLogoFieldProps) {
  return (
    <ImageFileField
      name="image"
      label="Main image"
      currentImage={
        <Image
          imageId={imageId}
          updatedAt={updatedAt}
          alt="Workspace logo"
          className={IMAGE_FIELD_PICTURE_CLASSES}
        />
      }
      previewAlt="Workspace logo"
      error={error}
    />
  );
}
