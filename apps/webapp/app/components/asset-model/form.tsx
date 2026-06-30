/**
 * Asset Model Form Component
 *
 * Renders a Card-based form for creating or editing asset models.
 * Supports two modes:
 * - **Page mode** (default): Full-page layout with Card, FormRow, and
 *   navigation buttons. Used by the create/edit routes.
 * - **Inline/dialog mode**: When `onSuccess` is provided, uses a fetcher
 *   so the form can live inside a dialog without triggering a page navigation.
 *
 * @see {@link file://./../../routes/_layout+/settings.asset-models.new.tsx}
 * @see {@link file://./../../routes/_layout+/settings.asset-models.$assetModelId_.edit.tsx}
 */
import { useEffect } from "react";
import type { AssetModel } from "@prisma/client";
import { useActionData, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { action } from "~/routes/_layout+/settings.asset-models.new";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { zodFieldIsRequired } from "~/utils/zod";
import { Form } from "../custom-form";
import DynamicSelect from "../dynamic-select/dynamic-select";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

/** Zod schema for creating/editing an asset model. */
export const AssetModelFormSchema = z.object({
  name: z.string().min(2, "Name is required"),
  description: z.string().optional(),
  defaultCategoryId: z.string().optional(),
  defaultValuation: z
    .string()
    .optional()
    .transform((val) => (val ? +val : null)),
  preventRedirect: z.string().optional(),
});

/** Props accepted by the AssetModelForm component. */
type AssetModelFormProps = {
  /** Pre-filled values for edit mode */
  assetModel?: Pick<
    AssetModel,
    "name" | "description" | "defaultCategoryId" | "defaultValuation"
  >;
  /** The API URL to submit the form to (used in inline/dialog mode). */
  apiUrl?: string;
  /** Callback function to handle cancel action when form is used inline. */
  onCancel?: () => void;
  /** Callback function triggered on successful creation (enables inline mode). */
  onSuccess?: (data?: { assetModel?: AssetModel }) => void;
};

/**
 * Renders the asset model create/edit form.
 *
 * When `onSuccess` is provided the form renders inside a compact inline layout
 * using a fetcher. Otherwise it renders as a full-page Card with FormRow fields.
 */
export default function AssetModelForm({
  assetModel,
  apiUrl,
  onCancel,
  onSuccess,
}: AssetModelFormProps) {
  const zo = useZorm("AssetModelForm", AssetModelFormSchema);
  const fetcher = useFetcherWithReset<typeof action>();
  // Replaces `autoFocus` on the Name input. Mounts inside a layout Dialog
  // (which also sets `data-dialog-initial-focus` here), but the hook is the
  // source of truth so jsx-a11y/no-autofocus passes.
  const nameInputRef = useAutoFocus<HTMLInputElement>();
  // Fetcher-scoped disabled for the inline/dialog mode. The full-page mode
  // uses navigation-based disabled wired up inside FullPageForm.
  const disabled = useDisabled(fetcher);

  /** Whether the form is used inside a dialog with an onSuccess callback. */
  const hasOnSuccessFunc = typeof onSuccess === "function";

  useEffect(() => {
    if (!hasOnSuccessFunc) {
      return;
    }

    if (fetcher.data && "assetModel" in fetcher.data) {
      onSuccess(fetcher.data);
      fetcher.reset();
    }
  }, [fetcher, onSuccess, hasOnSuccessFunc]);

  /* ------------------------------------------------------------------ */
  /*  Validation errors (inline mode only)                               */
  /* ------------------------------------------------------------------ */

  /** Server-side validation errors from the fetcher (inline mode). */
  const fetcherValidationErrors = getValidationErrors<
    typeof AssetModelFormSchema
  >(fetcher.data?.error);

  const nameError =
    fetcherValidationErrors?.name?.message || zo.errors.name()?.message;

  /* ------------------------------------------------------------------ */
  /*  Inline / dialog mode                                               */
  /* ------------------------------------------------------------------ */

  if (hasOnSuccessFunc) {
    return (
      <fetcher.Form
        method="post"
        className="w-full rounded border border-gray-200 bg-white px-6 py-5"
        ref={zo.ref}
        action={apiUrl}
      >
        <div className="gap-4 md:flex md:items-end">
          <Input
            ref={nameInputRef}
            label="Name"
            placeholder="Asset model name"
            className="mb-4 lg:mb-0 lg:max-w-[180px]"
            name={zo.fields.name()}
            disabled={disabled}
            error={nameError}
            data-dialog-initial-focus
            required={zodFieldIsRequired(AssetModelFormSchema.shape.name)}
            defaultValue={assetModel?.name}
          />
          <Input
            label="Description"
            placeholder="Description (optional)"
            name={zo.fields.description()}
            disabled={disabled}
            className="mb-4 lg:mb-0"
            defaultValue={assetModel?.description || undefined}
          />
          <input type="hidden" name="preventRedirect" value="true" />
        </div>

        <div className="mt-4">
          <div className="flex items-center gap-1">
            {onCancel ? (
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                size="sm"
                className="flex-1"
                disabled={disabled}
              >
                Cancel
              </Button>
            ) : null}
            <Button
              type="submit"
              size="sm"
              className="flex-1"
              disabled={disabled}
            >
              {disabled ? "Creating..." : "Create"}
            </Button>
          </div>

          <div className="mt-3 self-end text-sm text-error-500">
            {fetcher?.data?.error ? fetcher.data.error.message : " "}
          </div>
        </div>
      </fetcher.Form>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Full-page Card mode                                                */
  /* ------------------------------------------------------------------ */

  return <FullPageForm assetModel={assetModel} />;
}

/* ====================================================================== */
/*  Full-page form (Card layout)                                          */
/* ====================================================================== */

/**
 * Renders the full-page Card-based form layout with FormRow fields.
 * Extracted as a separate component so we can safely call `useLoaderData`
 * only when we are sure we are rendering inside a route (not a dialog).
 */
function FullPageForm({
  assetModel,
}: {
  assetModel?: AssetModelFormProps["assetModel"];
}) {
  const zo = useZorm("AssetModelForm", AssetModelFormSchema);
  // Page form submits via navigation, so the disabled state must watch the
  // router's navigation state — not a fetcher.
  const disabled = useDisabled();
  // Replaces `autoFocus` on the Name input — focuses on mount (full-page
  // mode, no `open` gate needed).
  const nameInputRef = useAutoFocus<HTMLInputElement>();
  const { currency } = useLoaderData<{
    currency: string;
    categories: unknown[];
    totalCategories: number;
  }>();

  /** Server-side validation errors from the page action. */
  const actionData = useActionData<DataOrErrorResponse>();
  const validationErrors = getValidationErrors<typeof AssetModelFormSchema>(
    actionData?.error
  );

  return (
    <Card className="w-full lg:w-min">
      <Form ref={zo.ref} method="post" className="flex w-full flex-col gap-2">
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
          subHeading="Assets created from this model will inherit this category."
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
          subHeading="Assets created from this model will inherit this value."
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
