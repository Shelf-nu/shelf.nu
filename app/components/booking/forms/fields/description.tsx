import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";

export function DescriptionField({
  description,
  fieldName,
  disabled,
  error,
}: {
  description: string | undefined;
  fieldName: string;
  disabled: boolean;
  error?: string;
}) {
  return (
    <FormRow
      rowLabel="Description"
      className="mobile-styling-only border-b-0 p-0 h-full"
    >
      <Input
        label="Description"
        inputType="textarea"
        hideLabel
        name={fieldName}
        disabled={disabled}
        error={error}
        className="mobile-styling-only w-full p-0"
        defaultValue={description || undefined}
        placeholder="Add a description..."
      />
    </FormRow>
  );
}
