import { useZorm } from "react-zorm";
import z from "zod";
import Input from "../forms/input";
import { zodFieldIsRequired } from "~/utils/zod";
import { ColorInput } from "../forms/color-input";
import { Button } from "../shared/button";
import { getRandomColor } from "~/utils/get-random-color";
import { useEffect, useMemo } from "react";
import { tw } from "~/utils/tw";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";

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
  onSuccess?: () => void;
};

export default function NewCategoryForm({
  formClassName,
  className,
  inputClassName,
  buttonsClassName,
  apiUrl,
  onSuccess,
}: NewCategoryFormProps) {
  const zo = useZorm("NewQuestionWizardScreen", NewCategoryFormSchema);
  const fetcher = useFetcherWithReset<{
    error?: { message: string };
    success: boolean;
  }>();
  const disabled = useDisabled(fetcher);

  const color = useMemo(() => getRandomColor(), []);

  useEffect(() => {
    if (typeof onSuccess !== "function") {
      return;
    }

    if (fetcher.data?.success) {
      onSuccess();
      fetcher.reset();
    }
  }, [fetcher, onSuccess]);

  return (
    <fetcher.Form
      method="post"
      className={tw(
        "rounded border border-gray-200 bg-white px-6 py-5 md:flex md:items-center w-full md:justify-between",
        formClassName
      )}
      ref={zo.ref}
      action={apiUrl}
    >
      <div className={tw("md:flex md:items-center gap-4", className)}>
        <Input
          label="Name"
          placeholder="Category name"
          className={tw("mb-4 lg:mb-0 lg:max-w-[180px]", inputClassName)}
          name={zo.fields.name()}
          disabled={disabled}
          error={zo.errors.name()?.message}
          hideErrorText
          autoFocus
          required={zodFieldIsRequired(NewCategoryFormSchema.shape.name)}
        />
        <Input
          label="Description"
          placeholder="Description (optional)"
          name={zo.fields.description()}
          disabled={disabled}
          data-test-id="categoryDescription"
          className={tw("mb-4 lg:mb-0", inputClassName)}
          required={zodFieldIsRequired(NewCategoryFormSchema.shape.description)}
        />
        <div className={tw("mb-6 lg:mb-0", inputClassName)}>
          <ColorInput
            name={zo.fields.color()}
            disabled={disabled}
            error={zo.errors.color()?.message}
            hideErrorText
            colorFromServer={color}
            required={zodFieldIsRequired(NewCategoryFormSchema.shape.color)}
          />
        </div>

        {typeof onSuccess === "function" ? (
          <input type="hidden" name="preventRedirect" value="true" />
        ) : null}
      </div>

      <div className={buttonsClassName}>
        <div className="flex gap-1 items-center">
          <Button
            variant="secondary"
            to="/categories"
            size="sm"
            className="flex-1"
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" className="flex-1">
            Create
          </Button>
        </div>

        <div className="mt-3 text-sm text-error-500 self-end">
          {fetcher?.data?.error ? fetcher.data.error.message : " "}
        </div>
      </div>
    </fetcher.Form>
  );
}
