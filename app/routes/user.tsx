import type { ActionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useTransition } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";

import { useMatchesData } from "~/hooks";
import { updateUser } from "~/modules/user";
import type { UpdateUserPayload } from "~/modules/user/types";
import type { RootData } from "~/root";

import { assertIsPost, isFormProcessing } from "~/utils";

export const UpdateFormSchema = z.object({
  id: z.string(),
  username: z
    .string()
    .min(4, { message: "Must be at least 4 characters long" }),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

export async function action({ request }: ActionArgs) {
  assertIsPost(request);
  const formData = await request.formData();
  const result = await UpdateFormSchema.safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      { status: 400 }
    );
  }

  const updateUserPayload: UpdateUserPayload = result?.data;
  return await updateUser(updateUserPayload);
}

export default function UserPage() {
  const zo = useZorm("NewQuestionWizardScreen", UpdateFormSchema);
  const transition = useTransition();
  const disabled = isFormProcessing(transition.state);

  /** Get the data from the action,  */
  let user = useMatchesData<RootData>("root")?.user;

  return (
    <div className="flex h-full min-h-screen flex-col px-16 py-20">
      <h2>Your user</h2>
      <Form method="post" ref={zo.ref} className="mt-10">
        <div className="mt-4">
          <label>
            <span>{zo.fields.username()}</span>
            <Input
              className="ml-10"
              type="text"
              name={zo.fields.username()}
              defaultValue={user?.username || undefined}
              error={zo.errors.username()?.message}
              // @TODO need to add error for unique username
            />
          </label>
        </div>

        <div className="mt-4">
          <label>
            <span>First name</span>
            <Input
              className="ml-10"
              type="text"
              name={zo.fields.firstName()}
              defaultValue={user?.firstName || undefined}
              error={zo.errors.firstName()?.message}
              // @TODO need to add error for unique username
            />
          </label>
        </div>

        <div className="mt-4">
          <label>
            <span>Last name</span>
            <Input
              className="ml-10"
              type="text"
              name={zo.fields.lastName()}
              defaultValue={user?.lastName || undefined}
              error={zo.errors.lastName()?.message}
              // @TODO need to add error for unique username
            />
          </label>
        </div>

        <input type="hidden" name={zo.fields.id()} defaultValue={user?.id} />

        <div className="mt-4 text-right">
          <button
            className="rounded bg-blue-500  py-2 px-4 text-white focus:bg-blue-400 hover:bg-blue-600"
            disabled={disabled}
          >
            Save
          </button>
        </div>
      </Form>
    </div>
  );
}
