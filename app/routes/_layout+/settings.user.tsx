import type { ActionArgs, V2_MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

import { useMatchesData } from "~/hooks";
import { requireAuthSession, updateAccountPassword } from "~/modules/auth";
import { updateUser } from "~/modules/user";
import type {
  UpdateUserPayload,
  UpdateUserResponse,
} from "~/modules/user/types";
import type { RootData } from "~/root";

import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

const ResetPasswordSchema = z
  .object({
    password: z.string().min(8, "Passowrd is too short. Minimum 8 characters."),
    confirmPassword: z
      .string()
      .min(8, "Passowrd is too short. Minimum 8 characters."),
  })
  .superRefine(({ password, confirmPassword }, ctx) => {
    if (password !== confirmPassword) {
      return ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password and confirm password must match",
        path: ["confirmPassword"],
      });
    }

    return { password, confirmPassword };
  });

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

  /** Handle Password Reset */
  if (formData.get("intent") === "updatePassword") {
    const result = await ResetPasswordSchema.safeParseAsync(
      parseFormAny(formData)
    );

    if (!result.success) {
      return json(
        {
          message:
            "Invalid request. Please try again. If the issue persists, contact support.",
        },
        { status: 400 }
      );
    }

    const { password } = result.data;
    const authSession = await requireAuthSession(request);
    const user = await updateAccountPassword(authSession.userId, password);

    if (!user) {
      return json(
        {
          message: "Issue updating passowrd",
        },
        { status: 500 }
      );
    }

    return json({ message: null, email: null, passwordUpdated: true });
  }

  /** Handle the use update */
  if (formData.get("intent") === "updateUser") {
    const result = await UpdateFormSchema.safeParseAsync(
      parseFormAny(formData)
    );

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
  const zoResetPwd = useZorm("ResetPasswordForm", ResetPasswordSchema);

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
      <Form method="post" ref={zo.ref} className="mt-10" replace>
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
          <Button
            disabled={disabled}
            type="submit"
            name="intent"
            value="updateUser"
          >
            Save
          </Button>
        </div>
      </Form>

      <div className="my-10" />
      <div className=" mb-6">
        <h3 className="text-text-lg font-semibold">Password</h3>
        <p className="text-sm text-gray-600">Update your password here</p>
      </div>

      <Form method="post" ref={zoResetPwd.ref} replace>
        <FormRow rowLabel="New password" className="border-t">
          <Input
            label="Password"
            hideLabel={true}
            data-test-id="password"
            name={zoResetPwd.fields.password()}
            type="password"
            autoComplete="new-password"
            placeholder="********"
            disabled={disabled}
            error={zoResetPwd.errors.password()?.message}
          />
        </FormRow>
        <FormRow rowLabel="Confirm password">
          <Input
            label="Confirm password"
            hideLabel={true}
            data-test-id="confirmPassword"
            name={zoResetPwd.fields.confirmPassword()}
            type="password"
            autoComplete="new-password"
            placeholder="********"
            disabled={disabled}
            error={zoResetPwd.errors.confirmPassword()?.message}
          />
        </FormRow>
        <div className="mt-4 text-right">
          <Button
            type="submit"
            disabled={disabled}
            name="intent"
            value="updatePassword"
          >
            Change password
          </Button>
        </div>
      </Form>
    </div>
  );
}
