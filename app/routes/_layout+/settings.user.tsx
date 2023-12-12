import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";

import { Form, useActionData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import { fileErrorAtom, validateFileAtom } from "~/atoms/file";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import PasswordResetForm from "~/components/user/password-reset-form";
import ProfilePicture from "~/components/user/profile-picture";

import { useUserData } from "~/hooks";
import {
  commitAuthSession,
  destroyAuthSession,
  requireAuthSession,
  sendResetPasswordLink,
} from "~/modules/auth";
import { updateProfilePicture, updateUser } from "~/modules/user";
import type {
  UpdateUserPayload,
  UpdateUserResponse,
} from "~/modules/user/types";

import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { delay } from "~/utils/delay";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { zodFieldIsRequired } from "~/utils/zod";

export const UpdateFormSchema = z.object({
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

export async function action({ request }: ActionFunctionArgs) {
  const authSession = await requireAuthSession(request);
  assertIsPost(request);

  const clonedRequest = request.clone();
  const formData = await clonedRequest.formData();

  /** Handle Password Reset */
  if (formData.get("intent") === "resetPassword") {
    const email = formData.get("email") as string;

    const { error } = await sendResetPasswordLink(email);

    if (error) {
      return json(
        {
          message: "Unable to send password reset link",
          email: null,
        },
        { status: 500 }
      );
    }

    /** Logout user after 3 seconds */
    await delay(2000);
    return destroyAuthSession(clonedRequest);
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
    const updateUserPayload: UpdateUserPayload = {
      ...result?.data,
      id: authSession.userId,
    };

    await updateProfilePicture({
      request,
      userId: authSession.userId,
    });

    /** Update the user */
    const updatedUser = await updateUser(updateUserPayload);

    if (updatedUser.errors) {
      return json({ errors: updatedUser.errors }, { status: 400 });
    }

    sendNotification({
      title: "User updated",
      message: "Your settings have been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return json(
      { success: true },
      {
        headers: {
          "Set-Cookie": await commitAuthSession(request, { authSession }),
        },
      }
    );
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuthSession(request);

  const title = "User Settings";

  return json({ title });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function UserPage() {
  const zo = useZorm("NewQuestionWizardScreen", UpdateFormSchema);
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const data = useActionData<UpdateUserResponse>();
  const errors = data?.errors as UpdateUserResponse["errors"];
  const user = useUserData();
  const usernameError = errors?.username || zo.errors.username()?.message;

  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);
  return (
    <div className=" flex flex-col">
      <div className=" mb-6">
        <h3 className="text-text-lg font-semibold">My details</h3>
        <p className="text-sm text-gray-600">
          Update your photo and personal details here.
        </p>
      </div>
      <Form
        method="post"
        ref={zo.ref}
        className=""
        replace
        encType="multipart/form-data"
      >
        <FormRow
          rowLabel={"Full name"}
          className="border-t-[1px]"
          required={zodFieldIsRequired(UpdateFormSchema.shape.firstName)}
        >
          <div className="flex gap-6">
            <Input
              label="First name"
              type="text"
              name={zo.fields.firstName()}
              defaultValue={user?.firstName || undefined}
              error={zo.errors.firstName()?.message}
              required={zodFieldIsRequired(UpdateFormSchema.shape.firstName)}
            />
            <Input
              label="Last name"
              type="text"
              name={zo.fields.lastName()}
              defaultValue={user?.lastName || undefined}
              error={zo.errors.lastName()?.message}
              required={zodFieldIsRequired(UpdateFormSchema.shape.lastName)}
            />
          </div>
        </FormRow>

        <FormRow
          rowLabel="Email address"
          required={zodFieldIsRequired(
            UpdateFormSchema.shape.email._def.schema
          )}
        >
          {/* Actial field used for resetting pwd and updating user */}
          <input
            type="hidden"
            name={zo.fields.email()}
            defaultValue={user?.email}
            className="hidden w-full"
          />
          {/* Just previews the email address */}
          <Input
            label={zo.fields.email()}
            icon="mail"
            hideLabel={true}
            placeholder="zaans@huisje.com"
            type="text"
            defaultValue={user?.email}
            className="w-full"
            disabled={true}
            title="To change your email address, please contact support."
            required={zodFieldIsRequired(
              UpdateFormSchema.shape.email._def.schema
            )}
          />
        </FormRow>

        <FormRow
          rowLabel="Username"
          required={zodFieldIsRequired(UpdateFormSchema.shape.username)}
        >
          <Input
            label="Username"
            hideLabel={true}
            addOn="shelf.nu/"
            type="text"
            name={zo.fields.username()}
            defaultValue={user?.username || undefined}
            error={usernameError}
            className="w-full"
            inputClassName="flex-1"
            required={zodFieldIsRequired(UpdateFormSchema.shape.username)}
          />
        </FormRow>

        <FormRow
          rowLabel="Profile picture"
          // subHeading="This will be displayed on your profile."
          className="border-t"
        >
          <div className="flex gap-3">
            <ProfilePicture />
            <div>
              <p>Accepts PNG, JPG or JPEG (max.4 MB)</p>
              <Input
                disabled={disabled}
                accept="image/png,.png,image/jpeg,.jpg,.jpeg"
                name="profile-picture"
                type="file"
                onChange={validateFile}
                label={"profile-picture"}
                hideLabel
                error={fileError}
                className="mt-2"
                inputClassName="border-0 shadow-none p-0 rounded-none"
              />
            </div>
          </div>
        </FormRow>

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

      <div className=" my-6">
        <h3 className="text-text-lg font-semibold">Password</h3>
        <p className="text-sm text-gray-600">Update your password here</p>
      </div>
      <PasswordResetForm userEmail={user?.email || ""} />
    </div>
  );
}
