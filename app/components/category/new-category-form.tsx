import { useEffect, useMemo } from "react";
import type { Category } from "@prisma/client";
import { useZorm } from "react-zorm";
import z from "zod";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { action } from "~/routes/_layout+/categories.new";
import { getRandomColor } from "~/utils/get-random-color";
import { getValidationErrors } from "~/utils/http";
import { tw } from "~/utils/tw";
import { zodFieldIsRequired } from "~/utils/zod";
import { ColorInput } from "../forms/color-input";
import Input from "../forms/input";
import { Button } from "../shared/button";

export const NewCategoryFormSchema = z.object({
  name: z.string().min(3, "Name is required"),
  description: z.string(),
  color: z.string().regex(/^#/).min(7),
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

  // Compute field-specific errors: prefer Zod client-side validation errors,
  // fall back to server validation errors only in inline mode
  const nameError =
    zo.errors.name()?.message ??
    (hasOnSuccessFunc ? validationErrors?.name?.message : undefined);

  const colorError =
    zo.errors.color()?.message ??
    (hasOnSuccessFunc ? validationErrors?.color?.message : undefined);

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
      <div className={tw("gap-4 md:flex md:items-center", className)}>
        <Input
          label="Name"
          placeholder="Category name"
          className={tw("mb-4 lg:mb-0 lg:max-w-[180px]", inputClassName)}
          name={zo.fields.name()}
          disabled={disabled}
          error={nameError}
          hideErrorText={!hasOnSuccessFunc}
          autoFocus
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
          hideErrorText={!hasOnSuccessFunc}
          required={zodFieldIsRequired(NewCategoryFormSchema.shape.description)}
        />
        <div className={tw("mb-6 lg:mb-0", inputClassName)}>
          <ColorInput
            name={zo.fields.color()}
            disabled={disabled}
            error={colorError}
            hideErrorText={!hasOnSuccessFunc}
            colorFromServer={color}
            required={zodFieldIsRequired(NewCategoryFormSchema.shape.color)}
          />
        </div>

        {hasOnSuccessFunc ? (
          <input type="hidden" name="preventRedirect" value="true" />
        ) : null}
      </div>

      <div className={buttonsClassName}>
        <div className="flex items-center gap-1">
          {/* When onCancel is provided (inline mode), use onClick instead of navigation */}
          {onCancel ? (
            <Button
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

        <div className="mt-3 self-end text-sm text-error-500">
          {fetcher?.data?.error ? fetcher.data.error.message : " "}
        </div>
      </div>
    </fetcher.Form>
  );
}
