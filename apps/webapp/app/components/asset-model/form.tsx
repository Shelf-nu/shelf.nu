/**
 * Asset Model Form Component
 *
 * The settings page form for creating or editing an asset model: a Card with
 * FormRow fields, submitted by navigation. The dialog version used inside
 * selects is `inline-form.tsx`, kept apart so the dialog does not load the
 * custom field default editors this form renders.
 *
 * @see {@link file://./inline-form.tsx}
 * @see {@link file://./../../routes/_layout+/settings.asset-models.new.tsx}
 * @see {@link file://./../../routes/_layout+/settings.asset-models.$assetModelId_.edit.tsx}
 */
import type { AssetModel, Currency } from "@prisma/client";
import { useAtomValue } from "jotai";
import { useActionData, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import {
  assetModelImageErrorAtom,
  assetModelImageValidateFileAtom,
} from "~/atoms/file";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import type { ICustomFieldValueJson } from "~/modules/asset/types";
import type { ModelDefaultFieldOption } from "~/modules/asset-model/defaults.server";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { AssetModelCustomFieldDefaults } from "./custom-field-defaults";
import { AssetModelFormSchema } from "./schema";
import { Form } from "../custom-form";
import DynamicSelect from "../dynamic-select/dynamic-select";
import FormRow from "../forms/form-row";
import {
  IMAGE_FIELD_PICTURE_CLASSES,
  IMAGE_HINT_8MB,
  ImageFileField,
} from "../forms/image-file-field";
import Input from "../forms/input";
import ImageWithPreview from "../image-with-preview/image-with-preview";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import When from "../when/when";

/** Re-exported for the settings routes that parse this form. */
export { AssetModelFormSchema };

/** Props accepted by the AssetModelForm component. */
type AssetModelFormProps = {
  /** Pre-filled values for edit mode */
  assetModel?: Pick<
    AssetModel,
    | "name"
    | "description"
    | "defaultCategoryId"
    | "defaultValuation"
    | "image"
    | "thumbnailImage"
  > & {
    /** Assets of this model that currently show its cover image (i.e. have no
     * image of their own). Drives the blast-radius hint under the field. */
    _count?: { assets: number };
  };
};

/**
 * Renders the asset model create/edit form of the settings pages: a Card with
 * FormRow fields, including the model's default custom field values.
 *
 * @param props - The model being edited, if any
 * @returns The page form
 */
export default function AssetModelForm({ assetModel }: AssetModelFormProps) {
  const zo = useZorm("AssetModelForm", AssetModelFormSchema);
  // Page form submits via navigation, so the disabled state must watch the
  // router's navigation state — not a fetcher.
  const disabled = useDisabled();
  // Replaces `autoFocus` on the Name input — focuses on mount (full-page
  // mode, no `open` gate needed).
  const nameInputRef = useAutoFocus<HTMLInputElement>();
  const { currency, modelDefaultFields, modelDefaultValues } = useLoaderData<{
    currency: Currency;
    categories: unknown[];
    totalCategories: number;
    /** Custom fields the model can hold a default for. */
    modelDefaultFields: ModelDefaultFieldOption[];
    /** The model's saved defaults, keyed by custom field id (edit only). */
    modelDefaultValues?: Record<string, ICustomFieldValueJson>;
  }>();

  /** Server-side validation errors from the page action. */
  const actionData = useActionData<DataOrErrorResponse>();
  const validationErrors = getValidationErrors<typeof AssetModelFormSchema>(
    actionData?.error
  );

  // Error slot of this form's own file guard (type + 8MB cap, the same rules
  // as asset and kit images); the image field runs the guard itself.
  const fileError = useAtomValue(assetModelImageErrorAtom);

  /**
   * The image upload has no zod field (a File can't be parsed by the text
   * schema), so its errors arrive either as the client-side file guard's
   * message or as the server's `field: "image"` ShelfError.
   */
  /** Server messages for the `cf-<id>` default inputs. */
  const customFieldErrors = Object.fromEntries(
    Object.entries(
      (validationErrors ?? {}) as Record<string, { message?: string }>
    )
      .filter(([key]) => key.startsWith("cf-"))
      .map(([key, value]) => [key, value?.message])
  );

  const imageError =
    (actionData?.error?.additionalData?.field === "image"
      ? actionData?.error?.message
      : undefined) ?? fileError;

  return (
    <Card className="w-full lg:w-min">
      <Form
        ref={zo.ref}
        method="post"
        className="flex w-full flex-col gap-2"
        encType="multipart/form-data"
      >
        {/* -- Top action bar (visible on md+) -- */}
        <div className="flex items-start justify-between border-b pb-5">
          <div>
            <h2 className="mb-1 text-[18px] font-semibold">Asset model</h2>
            <p>
              {assetModel
                ? "Edit the details of your asset model."
                : "Define a reusable template for your assets."}
            </p>
          </div>
          <div className="hidden flex-1 justify-end gap-2 md:flex">
            <Actions disabled={disabled} />
          </div>
        </div>

        {/* -- Name -- */}
        <FormRow
          rowLabel="Name"
          className="border-b-0 pb-[10px]"
          required={true}
        >
          <Input
            ref={nameInputRef}
            label="Name"
            hideLabel
            name={zo.fields.name()}
            disabled={disabled}
            error={validationErrors?.name?.message || zo.errors.name()?.message}
            className="w-full"
            placeholder="e.g. MacBook Pro 16-inch"
            defaultValue={assetModel?.name || ""}
            required={true}
          />
        </FormRow>

        {/* -- Description -- */}
        <FormRow
          rowLabel="Description"
          subHeading="A short description of this asset model. Maximum 1000 characters."
          className="border-b-0 pb-[10px]"
        >
          <Input
            inputType="textarea"
            maxLength={1000}
            label="Description"
            hideLabel
            name={zo.fields.description()}
            disabled={disabled}
            className="w-full"
            placeholder="Add a description for this asset model."
            defaultValue={assetModel?.description || ""}
          />
        </FormRow>

        {/* -- Default Category -- */}
        <FormRow
          rowLabel="Default category"
          subHeading="Fills an asset's empty category when it joins this model."
          className="border-b-0 pb-[10px]"
        >
          <DynamicSelect
            disabled={disabled}
            defaultValue={assetModel?.defaultCategoryId ?? undefined}
            model={{ name: "category", queryKey: "name" }}
            triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left"
            contentLabel="Categories"
            label="Category"
            hideLabel
            fieldName="defaultCategoryId"
            initialDataKey="categories"
            countKey="totalCategories"
            closeOnSelect
            selectionMode="set"
            allowClear={true}
          />
        </FormRow>

        {/* -- Default Valuation -- */}
        <FormRow
          rowLabel="Default valuation"
          subHeading="Fills an asset's empty value when it joins this model."
          className="border-b-0 py-[10px]"
        >
          <div className="relative w-full">
            <Input
              type="number"
              label="Default valuation"
              inputClassName="pl-[70px] valuation-input"
              hideLabel
              name={zo.fields.defaultValuation()}
              disabled={disabled}
              step="any"
              min={0}
              className="w-full"
              placeholder="0.00"
              defaultValue={
                assetModel?.defaultValuation != null
                  ? String(assetModel.defaultValuation)
                  : ""
              }
            />
            <span className="absolute bottom-0 border-r px-3 py-2.5 text-[16px] text-gray-600 lg:bottom-[11px]">
              {currency}
            </span>
          </div>
        </FormRow>

        {/* -- Image -- */}
        <FormRow
          rowLabel="Image"
          subHeading="Uploaded once and shown on every asset of this model that has no image of its own."
          className="border-b-0 pt-[10px]"
        >
          <ImageFileField
            name="image"
            label="Image"
            currentImage={
              assetModel?.image ? (
                // `imageUrl` is required alongside `withPreview`: the preview
                // trigger is keyboard-focusable and labelled "Open preview for
                // ...", but its handler no-ops without a full-size URL.
                <ImageWithPreview
                  imageUrl={assetModel.image}
                  thumbnailUrl={assetModel.thumbnailImage ?? assetModel.image}
                  alt={`${assetModel.name} image`}
                  className={IMAGE_FIELD_PICTURE_CLASSES}
                  withPreview
                />
              ) : null
            }
            previewAlt="Asset model image"
            validateFileAtom={assetModelImageValidateFileAtom}
            hint={IMAGE_HINT_8MB}
            belowInput={
              // Blast radius: replacing this image changes what these assets
              // show immediately. Nothing is copied, so every one of them
              // resolves the new URL on its next render.
              <When truthy={Boolean(assetModel?._count?.assets)}>
                <p className="mt-2 text-[12px] text-gray-500">
                  Used by <b>{assetModel?._count?.assets}</b>{" "}
                  {assetModel?._count?.assets === 1 ? "asset" : "assets"} that
                  {assetModel?._count?.assets === 1
                    ? " doesn't"
                    : " don't"}{" "}
                  have an image of their own.
                </p>
              </When>
            }
            error={imageError}
            disabled={disabled}
          />
        </FormRow>

        {/* -- Default custom field values -- */}
        <AssetModelCustomFieldDefaults
          fields={modelDefaultFields ?? []}
          values={modelDefaultValues ?? {}}
          currency={currency}
          errors={customFieldErrors}
          disabled={disabled}
        />

        {/* -- Bottom action bar -- */}
        <FormRow className="border-y-0 pb-0 pt-5" rowLabel="">
          <div className="flex flex-1 justify-end gap-2">
            <Actions disabled={disabled} />
          </div>
        </FormRow>
      </Form>
    </Card>
  );
}

/* ====================================================================== */
/*  Shared action buttons                                                  */
/* ====================================================================== */

/**
 * Cancel + Save buttons shared between top and bottom of the form.
 */
function Actions({ disabled }: { disabled: boolean }) {
  return (
    <>
      {/* Save is first in DOM so Enter triggers it */}
      <Button type="submit" disabled={disabled} className="order-last">
        {disabled ? "Saving..." : "Save"}
      </Button>
      <Button
        variant="secondary"
        to="/settings/asset-models"
        disabled={disabled}
      >
        Cancel
      </Button>
    </>
  );
}
