/**
 * Workspace logo field: the "Main image" file input of the workspace forms,
 * with a picture of the logo next to it.
 *
 * The picture shows, in order of precedence:
 * 1. the file the user just picked (a local object URL, before any upload),
 * 2. the owner's profile picture on a PERSONAL workspace, which is what the
 *    sidebar and the workspace list show for those,
 * 3. the stored logo, or the placeholder when the workspace has none.
 *
 * The input keeps the `image` field name the workspace actions read, and runs
 * the shared {@link defaultValidateFileAtom} rules (type + 4 MB). A rejected
 * file is cleared from the input by that validator, so the picture falls back
 * to the current logo rather than previewing a file that will not be uploaded.
 *
 * @see {@link file://./edit-form.tsx} Workspace settings form (current logo)
 * @see {@link file://./form.tsx} New-workspace form (preview only)
 * @see {@link file://../shared/image.tsx} Versioned `/api/image` URL contract
 */
import type { ChangeEvent } from "react";
import { useEffect, useState } from "react";
import { useSetAtom } from "jotai";
import { defaultValidateFileAtom } from "~/atoms/file";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import Input from "../forms/input";
import { Image } from "../shared/image";
import ProfilePicture from "../user/profile-picture";

/** Size and shape of the logo, shared by every picture state. */
const LOGO_CLASSES = "size-12 rounded-[4px] object-cover";

const HINT = "Accepts PNG, JPG, JPEG, or WebP (max.4 MB)";

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
  const validateFile = useSetAtom(defaultValidateFileAtom);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Each object URL pins its file in memory until revoked: release the old
  // one when the preview changes, and the last one on unmount.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  /**
   * Validates the picked file, then previews it, or falls back to the
   * current logo when the input ends up empty (a rejected file is cleared).
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

  let picture;
  if (previewUrl) {
    picture = (
      <img src={previewUrl} alt="Workspace logo" className={LOGO_CLASSES} />
    );
  } else if (isPersonal) {
    picture = (
      <ProfilePicture width="w-12" height="h-12" className="object-cover" />
    );
  } else {
    picture = (
      <Image
        imageId={imageId}
        updatedAt={updatedAt}
        alt="Workspace logo"
        className={LOGO_CLASSES}
      />
    );
  }

  return (
    <div className="flex gap-3">
      <div className="shrink-0">{picture}</div>
      <div className="min-w-0">
        <p className="hidden lg:block">{HINT}</p>
        <Input
          accept={ACCEPT_SUPPORTED_IMAGES}
          name="image"
          type="file"
          onChange={handleChange}
          label="Main image"
          hideLabel
          error={error}
          className="mt-2"
          inputClassName="border-0 shadow-none p-0 rounded-none"
        />
        <p className="mt-2 lg:hidden">{HINT}</p>
      </div>
    </div>
  );
}
