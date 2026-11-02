import { useEffect, useId, useMemo } from "react";
import type { Category } from "@prisma/client";
import { useZorm } from "react-zorm";
import z from "zod";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { action } from "~/routes/_layout+/categories.new";
import { getRandomColor } from "~/utils/get-random-color";
import { getValidationErrors } from "~/utils/http";
import { hexColorSchema, labelNameSchema } from "~/utils/label-form-fields";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import {
  ColorBadgePreview,
  useColorBadgePreview,
} from "../forms/color-badge-preview";
import { ColorInput } from "../forms/color-input";
import { FormRowErrors, rowErrorId } from "../forms/form-row-errors";
import Input from "../forms/input";
import { Button } from "../shared/button";

export const NewCategoryFormSchema = z.object({
  name: labelNameSchema,
  description: z.string(),
  color: hexColorSchema,
  preventRedirect: z.string().optional(),
});

type NewCategoryFormProps = {
  formClassName?: string;
  className?: string;
  inputClassName?: string;
  buttonsClassName?: string;
  apiUrl?: string;
  /** Callback function to handle cancel action when form is used inline (e.g., in a dialog). When provided, Cancel button will call this instead of navigating. */
  onCancel?: () => void;
  /** Callback function triggered on successful category creation */
  onSuccess?: (data?: { category?: Category }) => void;
};

export default function NewCategoryForm({
  formClassName,
  className,
  inputClassName,
  buttonsClassName,
  apiUrl,
  onCancel,
  onSuccess,
}: NewCategoryFormProps) {
  const zo = useZorm("NewQuestionWizardScreen", NewCategoryFormSchema);
  const fetcher = useFetcherWithReset<typeof action>();
  const disabled = useDisabled(fetcher);

  const color = useMemo(() => getRandomColor(), []);
  const { previewName, setPreviewName, previewColor, setPreviewColor } =
    useColorBadgePreview({ entityId: "new", name: "", color });

  // Focus the Name field on mount. When this form is rendered inside a
  // dialog the dialog's `data-dialog-initial-focus` handler typically wins;
  // otherwise (standalone /categories/new route) this provides intentional
  // initial focus.
  const nameInputRef = useAutoFocus<HTMLInputElement>();

  useEffect(() => {
    if (typeof onSuccess !== "function") {
      return;
    }

    // Check if response is success (has category, not error)
    if (fetcher.data && "category" in fetcher.data) {
      onSuccess(fetcher.data);
      fetcher.reset();
    }
  }, [fetcher, onSuccess]);

  const hasOnSuccessFunc = typeof onSuccess === "function";

  // Get validation errors from server response using the standard helper
  const validationErrors = getValidationErrors<typeof NewCategoryFormSchema>(
    fetcher.data?.error
  );

  // Field errors: client-side Zod errors first, server validation errors as
  // the fallback when client-side validation is bypassed.
  const nameError =
    zo.errors.name()?.message ?? validationErrors?.name?.message;

  const colorError =
    zo.errors.color()?.message ?? validationErrors?.color?.message;

  // Inline (dialog) mode stacks the fields, so each shows its own error. The
  // standalone page lays them out in one row, where per-field text would push
  // that field out of line: there they keep the red outline and the messages
  // are listed under the buttons instead.
  const showRowErrors = !hasOnSuccessFunc;
  const errorsId = useId();
  const rowErrorProps = (field: string, error: string | undefined) =>
    showRowErrors
      ? {
          hideErrorText: true,
          "aria-describedby": error ? rowErrorId(errorsId, field) : undefined,
        }
      : {};

  return (
    <fetcher.Form
      method="post"
      className={tw(
        "w-full rounded border border-gray-200 bg-white px-6 py-5 md:flex md:items-center md:justify-between",
        formClassName
      )}
      ref={zo.ref}
      action={apiUrl}
    >
      <div className={tw("flex flex-col", hasOnSuccessFunc && "w-full")}>
        <div className={tw("gap-4 md:flex md:items-center", className)}>
          <Input
            ref={nameInputRef}
            label="Name"
            placeholder="Category name"
            className={tw("mb-4 lg:mb-0 lg:max-w-[180px]", inputClassName)}
            name={zo.fields.name()}
            onChange={(e) => setPreviewName(e.target.value)}
            disabled={disabled}
            error={nameError}
            {...rowErrorProps("name", nameError)}
            data-dialog-initial-focus
            required={zodFieldIsRequired(NewCategoryFormSchema.shape.name)}
          />
          <Input
            label="Description"
            placeholder="Description (optional)"
            name={zo.fields.description()}
            disabled={disabled}
            data-test-id="categoryDescription"
            className={tw("mb-4 lg:mb-0", inputClassName)}
            required={zodFieldIsRequired(
              NewCategoryFormSchema.shape.description
            )}
          />
          <div className={tw("mb-6 lg:mb-0", inputClassName)}>
            <ColorInput
              name={zo.fields.color()}
              disabled={disabled}
              error={colorError}
              {...rowErrorProps("color", colorError)}
              colorFromServer={color}
              onColorChange={setPreviewColor}
              required
            />
          </div>

          {hasOnSuccessFunc ? (
            <input type="hidden" name="preventRedirect" value="true" />
          ) : null}
        </div>
        <ColorBadgePreview name={previewName} color={previewColor} />
      </div>

      <div className={buttonsClassName}>
        <div className="flex items-center gap-1">
          {/* When onCancel is provided (inline mode), use onClick instead of navigation */}
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
              to="/categories"
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
            {disabled ? "Creating..." : "Create"}
          </Button>
        </div>

        {showRowErrors && (nameError || colorError) ? (
          <FormRowErrors
            id={errorsId}
            errors={{ name: nameError, color: colorError }}
            className="mt-3 self-end text-sm text-error-500"
          />
        ) : (
          <div className="mt-3 self-end text-sm text-error-500">
            {fetcher?.data?.error ? fetcher.data.error.message : " "}
          </div>
        )}
      </div>
    </fetcher.Form>
  );
}
