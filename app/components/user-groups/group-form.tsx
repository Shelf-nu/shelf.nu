import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "../custom-form";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared/button";

export const GroupSchema = z.object({
  name: z.string().min(1, "Please enter group name."),
});

export default function GroupForm() {
  const zo = useZorm("user-group", GroupSchema);

  return (
    <Form ref={zo.ref} method="POST">
      <FormRow
        rowLabel="Name"
        className="mobile-styling-only mb-4 w-full border-b-0 p-0"
        required
        contentClassName="w-full"
      >
        <Input
          label="Name"
          hideLabel
          name={zo.fields.name()}
          error={zo.errors.name()?.message}
          autoFocus
          className="mobile-styling-only w-full p-0"
          placeholder="Name"
          required
        />
      </FormRow>

      <Button>Create group</Button>
    </Form>
  );
}
