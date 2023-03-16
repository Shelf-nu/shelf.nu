import type { ActionArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";

import { useMatchesData } from "~/hooks";
import { updateUser } from "~/modules/user";
import type {
  UpdateUserPayload,
  UpdateUserResponse,
} from "~/modules/user/types";
import type { RootData } from "~/root";

import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const UpdateFormSchema = z.object({
  id: z.string(),
  email: z
    .string()
    .email("Please enter a valid email.")
    .transform((email) => email.toLowerCase()),
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

  /** Create the payload if the client side validation works */
  const updateUserPayload: UpdateUserPayload = result?.data;

  /** Update the user */
  const updatedUser = await updateUser(updateUserPayload);

  if (updatedUser.errors) {
    return json({ errors: updatedUser.errors }, { status: 400 });
  }

  return updatedUser;
}

export async function loader() {
  const title = "User Settings";

  return json({ title });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.title) },
];

export default function UserPage() {
  const zo = useZorm("NewQuestionWizardScreen", UpdateFormSchema);
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const data = useActionData<UpdateUserResponse>();

  /** Get the data from the action,  */
  let user = useMatchesData<RootData>("routes/_layout+/_layout")?.user;

  return (
    <div className="">
      <div className=" mb-6">
        <h3 className="text-text-lg font-semibold">My details</h3>
        <p className="text-sm text-gray-600">
          Update your photo and personal details here.
        </p>
      </div>
      <Form method="post" ref={zo.ref} className="mt-10">
        <FormRow rowLabel={"Full name"} className="border-t-[1px]">
          <div className="flex gap-6">
            <Input
              label="First name"
              type="text"
              name={zo.fields.firstName()}
              defaultValue={user?.firstName || undefined}
              error={zo.errors.firstName()?.message}
            />
            <Input
              label="Last name"
              type="text"
              name={zo.fields.lastName()}
              defaultValue={user?.lastName || undefined}
              error={zo.errors.lastName()?.message}
              // @TODO need to add error for unique username
            />
          </div>
        </FormRow>

        <FormRow rowLabel="Email address">
          <Input
            label={zo.fields.email()}
            icon="mail"
            hideLabel={true}
            placeholder="zaans@huisje.com"
            type="text"
            name={zo.fields.email()}
            defaultValue={user?.email || undefined}
            error={zo.errors.email()?.message || data?.errors?.email}
          />
        </FormRow>

        <FormRow rowLabel="Username">
          <Input
            label="Username"
            hideLabel={true}
            addOn="shelf.nu/"
            type="text"
            name={zo.fields.username()}
            defaultValue={user?.username || undefined}
            error={zo.errors.username()?.message || data?.errors?.username}
          />
        </FormRow>

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
