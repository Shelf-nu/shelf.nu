import { useActionData } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import { useDisabled } from "~/hooks/use-disabled";
import type { getUserWithContact } from "~/modules/user/service.server";
import type { UserPageActionData } from "~/routes/_layout+/account-details.general";
import { getValidationErrors } from "~/utils/http";
import { Form } from "../custom-form";
import FormRow from "../forms/form-row";
import Input from "../forms/input";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

export const DisplayNameFormSchema = z.object({
  displayName: z.string().trim().optional(),
});

export function DisplayNameForm({
  user,
}: {
  user: ReturnType<typeof getUserWithContact>;
}) {
  const zo = useZorm("DisplayNameForm", DisplayNameFormSchema);
  const data = useActionData<UserPageActionData>();
  const disabled = useDisabled();

  const validationErrors = getValidationErrors<typeof DisplayNameFormSchema>(
    data?.error
  );

  return (
    <Card className="my-0">
      <div className="mb-6">
        <h3 className="text-text-lg font-semibold">Display name</h3>
        <p className="text-sm text-gray-600">
          Set a custom display name to override your SSO-provided name across
          the platform.
        </p>
      </div>
      <Form method="post" ref={zo.ref} replace>
        <FormRow
          rowLabel="Display name"
          className="border-b-0 border-t"
          required={false}
        >
          <Input
            label="Display name"
            hideLabel
            type="text"
            name={zo.fields.displayName()}
            defaultValue={user?.displayName || undefined}
            error={
              validationErrors?.displayName?.message ||
              zo.errors.displayName()?.message
            }
            disabled={disabled}
            placeholder={`${user?.firstName || ""} ${
              user?.lastName || ""
            }`.trim()}
          />
        </FormRow>
        <div className="text-right">
          <input type="hidden" name="type" value="updateDisplayName" />
          <Button
            disabled={disabled}
            type="submit"
            name="intent"
            value="updateDisplayName"
          >
            Save
          </Button>
        </div>
      </Form>
    </Card>
  );
}
