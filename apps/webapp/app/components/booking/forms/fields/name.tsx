import type { ChangeEventHandler } from "react";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { useAutoFocus } from "~/hooks/use-auto-focus";

export function NameField({
  name,
  fieldName,
  disabled,
  error,
  onChange,
  autoFocus = true,
}: {
  name: string | undefined;
  fieldName?: string;
  disabled?: boolean;
  error?: string;
  onChange: ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  /**
   * Focus the field on mount. On by default: NameField is the first field of
   * the new-booking form and the create-booking dialogs. The edit form on a
   * booking's overview turns it off, because a booking opened to be read must
   * not take keystrokes (the `[` / `]` record shortcuts, or a stray key that
   * would edit the name).
   */
  autoFocus?: boolean;
}) {
  const inputRef = useAutoFocus<HTMLInputElement>({ when: autoFocus });
  return (
    <FormRow
      rowLabel={"Name"}
      className="mobile-styling-only border-b-0 p-0"
      required
    >
      <Input
        ref={inputRef}
        label="Name"
        hideLabel
        name={fieldName}
        disabled={disabled}
        error={error}
        onChange={onChange}
        className="mobile-styling-only w-full p-0"
        defaultValue={name}
        placeholder="Booking"
        required
      />
    </FormRow>
  );
}
