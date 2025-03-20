import type { Group } from "@prisma/client";
import { useNavigation } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { isFormProcessing } from "~/utils/form";
import { Form } from "../custom-form";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared/button";

export const GroupSchema = z.object({
  name: z.string().min(1, "Please enter group name."),
});

type GroupFormProps = Partial<Pick<Group, "name">>;

export default function GroupForm({ name }: GroupFormProps) {
  const zo = useZorm("user-group", GroupSchema);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <Form ref={zo.ref} method="POST">
      <FormRow
        rowLabel="Name"
        className="mobile-styling-only mb-4 w-full border-b-0 p-0"
        required
        contentClassName="w-full"
      >
        <Input
          defaultValue={name}
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

      <Button disabled={disabled}>Create group</Button>
    </Form>
  );
}
