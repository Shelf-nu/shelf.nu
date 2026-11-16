/**
 * Inline Asset Model Form
 *
 * The short create form shown in the "Create new asset model" dialog inside
 * the model selects (asset form, bulk model update). It submits through a
 * fetcher to `apiUrl`, so creating a model never leaves the page, and hands
 * the new model to `onSuccess`.
 *
 * It must not import `./form` (the settings page form): that form renders the
 * custom field default editors, the markdown editor among them, which the
 * dialog never shows.
 *
 * @see {@link file://./form.tsx}
 * @see {@link file://./../inline-entity-creation-dialog/inline-entity-creation-forms.tsx}
 */
import { useEffect } from "react";
import type { AssetModel } from "@prisma/client";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import {
  assetModelImageErrorAtom,
  assetModelImageValidateFileAtom,
} from "~/atoms/file";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { action } from "~/routes/_layout+/settings.asset-models.new";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { getValidationErrors } from "~/utils/http";
import { zodFieldIsRequired } from "~/utils/zod";
import { AssetModelFormSchema } from "./schema";
import Input from "../forms/input";
import { Button } from "../shared/button";

/** Links the image input to the <p> stating its accepted formats and size. */
const IMAGE_HELP_ID = "asset-model-image-help-inline";

/** Props for {@link InlineAssetModelForm}. */
type InlineAssetModelFormProps = {
  /** The route action the form posts to */
  apiUrl: string;
  /** Closes the dialog without creating anything */
  onCancel?: () => void;
  /** Called with the action's response once the model is created */
  onSuccess: (data?: { assetModel?: AssetModel }) => void;
};

/**
 * Create form for an asset model inside a dialog: name, description and
 * cover image, one below the other.
 *
 * @param props - Where to post, and the dialog's callbacks
 * @returns The form
 */
export default function InlineAssetModelForm({
  apiUrl,
  onCancel,
  onSuccess,
}: InlineAssetModelFormProps) {
  const zo = useZorm("AssetModelForm", AssetModelFormSchema);
  const fetcher = useFetcherWithReset<typeof action>();
  const nameInputRef = useAutoFocus<HTMLInputElement>();
  const disabled = useDisabled(fetcher);

  useEffect(() => {
    if (fetcher.data && "assetModel" in fetcher.data) {
      onSuccess(fetcher.data);
      fetcher.reset();
    }
  }, [fetcher, onSuccess]);

  /** Server-side validation errors from the fetcher. */
  const validationErrors = getValidationErrors<typeof AssetModelFormSchema>(
    fetcher.data?.error
  );
  const nameError =
    validationErrors?.name?.message || zo.errors.name()?.message;

  // Client-side file guard (type + 8MB cap). Deliberately SCOPED, not the shared
  // `fileErrorAtom`: this dialog opens inside the asset form, whose own image
  // input would otherwise surface, and clear, this field's error.
  const [, validateFile] = useAtom(assetModelImageValidateFileAtom);
  const fileError = useAtomValue(assetModelImageErrorAtom);

  /**
   * The image has no zod field (a File can't be parsed by the text schema), so
   * its errors arrive either from the client-side guard or as the server's
   * `field: "image"` ShelfError on the fetcher.
   */
  const imageError =
    (fetcher.data?.error?.additionalData?.field === "image"
      ? fetcher.data.error.message
      : undefined) ?? fileError;

  return (
    <fetcher.Form
      method="post"
      className="flex w-full flex-col gap-4"
      ref={zo.ref}
      action={apiUrl}
      // Multipart so the dialog carries the cover image: without it the file
      // input posts nothing and the model has no image for its assets to show.
      encType="multipart/form-data"
    >
      <Input
        ref={nameInputRef}
        label="Name"
        placeholder="Asset model name"
        className="w-full"
        inputClassName="w-full"
        name={zo.fields.name()}
        disabled={disabled}
        error={nameError}
        data-dialog-initial-focus
        required={zodFieldIsRequired(AssetModelFormSchema.shape.name)}
      />
      <Input
        label="Description"
        placeholder="Description (optional)"
        className="w-full"
        inputClassName="w-full"
        name={zo.fields.description()}
        disabled={disabled}
      />
      <input type="hidden" name="preventRedirect" value="true" />

      <div>
        <Input
          label="Image"
          // Input spreads unknown props straight onto the <input> and adds no
          // describedby of its own, so this is the only link between the field
          // and its format/size requirements for assistive tech.
          aria-describedby={IMAGE_HELP_ID}
          disabled={disabled}
          accept={ACCEPT_SUPPORTED_IMAGES}
          name="image"
          type="file"
          onChange={validateFile}
          error={imageError}
          inputClassName="border-0 shadow-none p-0 rounded-none"
        />
        <p id={IMAGE_HELP_ID} className="mt-1 text-[12px] text-gray-500">
          Optional. Shown on every asset of this model that has no image of its
          own. PNG, JPG, JPEG or WebP, max. 8 MB.
        </p>
      </div>

      <div>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              className="flex-1"
              disabled={disabled}
            >
              Cancel
            </Button>
          ) : null}
          <Button type="submit" className="flex-1" disabled={disabled}>
            {disabled ? "Creating..." : "Create"}
          </Button>
        </div>

        {fetcher.data?.error ? (
          <p className="mt-3 text-sm text-error-500">
            {fetcher.data.error.message}
          </p>
        ) : null}
      </div>
    </fetcher.Form>
  );
}
