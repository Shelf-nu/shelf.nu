/**
 * "Main image" field of the workspace forms, with a picture of the
 * workspace's logo next to the file input.
 *
 * The saved picture mirrors the sidebar:
 * - a PERSONAL workspace shows the owner's profile picture,
 * - any other workspace shows its stored logo, or the placeholder when it has
 *   none.
 *
 * Picking a file previews it in place of that picture; validation and the
 * preview itself live in the shared {@link ImageFileField}.
 *
 * @see {@link file://./edit-form.tsx} Workspace settings form (saved logo)
 * @see {@link file://./form.tsx} New-workspace form (placeholder, preview)
 * @see {@link file://../forms/image-file-field.tsx} Preview and validation
 * @see {@link file://../shared/image.tsx} Versioned `/api/image` URL contract
 */
import { ImageFileField } from "../forms/image-file-field";
import { Image } from "../shared/image";
import ProfilePicture from "../user/profile-picture";

/** Size and shape of the logo, shared by the saved picture and the preview. */
const LOGO_CLASSES = "size-12 rounded-[4px] object-cover";

type WorkspaceLogoFieldProps = {
  /** Stored logo of the workspace; omit when there is none yet. */
  imageId?: string | null;
  /**
   * The workspace's `updatedAt`. Becomes the `?v=` version of the logo URL,
   * which `/api/image` needs to serve a replaced logo instead of a cached one.
   */
  updatedAt?: Date | string;
  /** PERSONAL workspace: show the owner's profile picture as the logo. */
  isPersonal?: boolean;
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
  isPersonal = false,
  error,
}: WorkspaceLogoFieldProps) {
  return (
    <ImageFileField
      name="image"
      label="Main image"
      currentImage={
        isPersonal ? (
          <ProfilePicture width="w-12" height="h-12" className="object-cover" />
        ) : (
          <Image
            imageId={imageId}
            updatedAt={updatedAt}
            alt="Workspace logo"
            className={LOGO_CLASSES}
          />
        )
      }
      previewAlt="Workspace logo"
      previewClassName={LOGO_CLASSES}
      error={error}
    />
  );
}
