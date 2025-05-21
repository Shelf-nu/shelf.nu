import type { ChangeEventHandler } from "react";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";

export function NameField({
  name,
  fieldName,
  disabled,
  error,
  onChange,
}: {
  name: string | undefined;
  fieldName?: string;
  disabled?: boolean;
  error?: string;
  onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}) {
  return (
    <FormRow
      rowLabel={"Name"}
      className="mobile-styling-only border-b-0 p-0"
      required
    >
      <Input
        label="Name"
        hideLabel
        name={fieldName}
        disabled={disabled}
        error={error}
        autoFocus
        onChange={onChange}
        className="mobile-styling-only w-full p-0"
        defaultValue={name}
        placeholder="Booking"
        required
      />
    </FormRow>
  );
}
