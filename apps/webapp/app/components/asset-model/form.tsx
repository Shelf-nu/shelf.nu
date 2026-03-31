import { useEffect } from "react";
import type { AssetModel } from "@prisma/client";
import { useZorm } from "react-zorm";
import z from "zod";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { action } from "~/routes/_layout+/asset-models.new";
import { getValidationErrors } from "~/utils/http";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import Input from "../forms/input";
import { Button } from "../shared/button";

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

type AssetModelFormProps = {
  /** Pre-filled values for edit mode */
  assetModel?: Pick<
    AssetModel,
    "name" | "description" | "defaultCategoryId" | "defaultValuation"
  >;
  formClassName?: string;
  className?: string;
  inputClassName?: string;
  buttonsClassName?: string;
  apiUrl?: string;
  /** Callback function to handle cancel action when form is used inline (e.g., in a dialog). */
  onCancel?: () => void;
  /** Callback function triggered on successful creation */
  onSuccess?: (data?: { assetModel?: AssetModel }) => void;
};

export default function AssetModelForm({
  assetModel,
  formClassName,
  className,
  inputClassName,
  buttonsClassName,
  apiUrl,
  onCancel,
  onSuccess,
}: AssetModelFormProps) {
  const zo = useZorm("AssetModelForm", AssetModelFormSchema);
  const fetcher = useFetcherWithReset<typeof action>();
  const disabled = useDisabled(fetcher);

  useEffect(() => {
    if (typeof onSuccess !== "function") {
      return;
    }

    if (fetcher.data && "assetModel" in fetcher.data) {
      onSuccess(fetcher.data);
      fetcher.reset();
    }
  }, [fetcher, onSuccess]);

  const hasOnSuccessFunc = typeof onSuccess === "function";

  const validationErrors = getValidationErrors<typeof AssetModelFormSchema>(
    fetcher.data?.error
  );

  const nameError =
    zo.errors.name()?.message ??
    (hasOnSuccessFunc ? validationErrors?.name?.message : undefined);

  return (
    <fetcher.Form
      method="post"
      className={tw(
        "w-full rounded border border-gray-200 bg-white px-6 py-5 md:flex md:items-end md:justify-between",
        formClassName
      )}
      ref={zo.ref}
      action={apiUrl}
    >
      <div className={tw("gap-4 md:flex md:items-end", className)}>
        <Input
          label="Name"
          placeholder="Asset model name"
          className={tw("mb-4 lg:mb-0 lg:max-w-[180px]", inputClassName)}
          name={zo.fields.name()}
          disabled={disabled}
          error={nameError}
          hideErrorText={!hasOnSuccessFunc}
          autoFocus
          data-dialog-initial-focus
          required={zodFieldIsRequired(AssetModelFormSchema.shape.name)}
          defaultValue={assetModel?.name}
        />
        <Input
          label="Description"
          placeholder="Description (optional)"
          name={zo.fields.description()}
          disabled={disabled}
          className={tw("mb-4 lg:mb-0", inputClassName)}
          hideErrorText={!hasOnSuccessFunc}
          defaultValue={assetModel?.description || undefined}
        />
        <Input
          label="Default valuation"
          type="number"
          step="0.01"
          placeholder="0.00"
          name={zo.fields.defaultValuation()}
          disabled={disabled}
          className={tw("mb-4 lg:mb-0 lg:max-w-[140px]", inputClassName)}
          hideErrorText={!hasOnSuccessFunc}
          defaultValue={
            assetModel?.defaultValuation != null
              ? String(assetModel.defaultValuation)
              : undefined
          }
        />

        {hasOnSuccessFunc ? (
          <input type="hidden" name="preventRedirect" value="true" />
        ) : null}
      </div>

      <div className={buttonsClassName}>
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
          ) : (
            <Button
              variant="secondary"
              to="/asset-models"
              size="sm"
              className="flex-1"
              disabled={disabled}
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            className="flex-1"
            disabled={disabled}
          >
            {disabled
              ? assetModel
                ? "Saving..."
                : "Creating..."
              : assetModel
              ? "Save"
              : "Create"}
          </Button>
        </div>

        <div className="mt-3 self-end text-sm text-error-500">
          {fetcher?.data?.error ? fetcher.data.error.message : " "}
        </div>
      </div>
    </fetcher.Form>
  );
}
