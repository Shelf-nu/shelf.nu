import type { User } from "@prisma/client";
import type { ActionFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import { useActionData, useNavigation } from "@remix-run/react";
import { useAtom, useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { fileErrorAtom, validateFileAtom } from "~/atoms/file";
import { Form } from "~/components/custom-form";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import {
  ChangeEmailForm,
  createChangeEmailSchema,
} from "~/components/user/change-email";
import PasswordResetForm from "~/components/user/password-reset-form";
import ProfilePicture from "~/components/user/profile-picture";
import { RequestDeleteUser } from "~/components/user/request-delete-user";
import {
  changeEmailAddressHtmlEmail,
  changeEmailAddressTextEmail,
} from "~/emails/change-user-email-address";

import { sendEmail } from "~/emails/mail.server";
import { useUserData } from "~/hooks/use-user-data";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  refreshAccessToken,
  sendResetPasswordLink,
} from "~/modules/auth/service.server";
import {
  getUserByID,
  updateProfilePicture,
  updateUser,
  updateUserEmail,
} from "~/modules/user/service.server";
import type { UpdateUserPayload } from "~/modules/user/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { ACCEPT_SUPPORTED_IMAGES } from "~/utils/constants";
import { delay } from "~/utils/delay";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ADMIN_EMAIL, SERVER_URL } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import { data, error, parseData } from "~/utils/http.server";
import { getConfiguredSSODomains } from "~/utils/sso.server";
import { zodFieldIsRequired } from "~/utils/zod";

const UpdateFormSchema = z.object({
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

// First we define our intent schema
const IntentSchema = z.object({
  intent: z.enum([
    "resetPassword",
    "updateUser",
    "deleteUser",
    "initiateEmailChange",
    "verifyEmailChange",
  ]),
});

// Then we define schemas for each intent type
const ActionSchemas = {
  resetPassword: z.object({
    type: z.literal("resetPassword"),
    email: z.string(),
  }),

  updateUser: UpdateFormSchema.extend({
    type: z.literal("updateUser"),
  }),

  deleteUser: z.object({
    type: z.literal("deleteUser"),
    email: z.string(),
    reason: z.string(),
  }),

  initiateEmailChange: z.object({
    type: z.literal("initiateEmailChange"),
    email: z.string().email(),
  }),

  verifyEmailChange: z.object({
    email: z.string().email(),
    type: z.literal("verifyEmailChange"),
    otp: z.string().min(6).max(6),
  }),
} as const;

// Helper function to get schema
function getActionSchema(intent: z.infer<typeof IntentSchema>["intent"]) {
  return ActionSchemas[intent].extend({ intent: z.literal(intent) });
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId, email } = authSession;

  try {
    // First parse just the intent
    const { intent } = parseData(
      await request.clone().formData(),
      IntentSchema
    );

    // Then parse the full payload with the correct schema
    const payload = parseData(
      await request.clone().formData(),
      getActionSchema(intent),
      {
        additionalData: { userId },
      }
    );

    switch (intent) {
      case "resetPassword": {
        if (payload.type !== "resetPassword")
          throw new Error("Invalid payload type");
        const { email } = payload;

        await sendResetPasswordLink(email);

        /** Logout user after 3 seconds */
        await delay(2000);

        context.destroySession();

        return redirect("/login");
      }
      case "updateUser": {
        if (payload.type !== "updateUser")
          throw new Error("Invalid payload type");
        /** Create the payload if the client side validation works */

        const updateUserPayload: UpdateUserPayload = {
          email: payload.email,
          username: payload.username,
          firstName: payload.firstName,
          lastName: payload.lastName,
          id: userId,
        };

        await updateProfilePicture({
          request,
          userId,
        });

        /** Update the user */
        await updateUser(updateUserPayload);

        sendNotification({
          title: "User updated",
          message: "Your settings have been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }));
      }
      case "deleteUser": {
        if (payload.type !== "deleteUser")
          throw new Error("Invalid payload type");

        let reason = "No reason provided";
        if ("reason" in payload && payload.reason) {
          reason = payload?.reason;
        }

        void sendEmail({
          to: ADMIN_EMAIL || `"Shelf" <updates@emails.shelf.nu>`,
          subject: "Delete account request",
          text: `User with id ${userId} and email ${payload.email} has requested to delete their account. \n User: ${SERVER_URL}/admin-dashboard/${userId} \n\n Reason: ${reason}\n\n`,
        });

        void sendEmail({
          to: payload.email,
          subject: "Delete account request received",
          text: `We have received your request to delete your account. It will be processed within 72 hours.\n\n Kind regards,\nthe Shelf team \n\n`,
        });

        sendNotification({
          title: "Account deletion request",
          message:
            "Your request has been sent to the admin and will be processed within 24 hours. You will receive an email confirmation.",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }));
      }
      case "initiateEmailChange": {
        if (payload.type !== "initiateEmailChange")
          throw new Error("Invalid payload type");

        const ssoDomains = await getConfiguredSSODomains();
        const user = await getUserByID(userId);
        // Validate the payload using our schema
        const { email: newEmail } = parseData(
          await request.clone().formData(),
          createChangeEmailSchema(
            email,
            ssoDomains.map((d) => d.domain)
          ),
          {
            additionalData: { userId },
          }
        );

        // Generate email change link/OTP
        const { data: linkData, error: generateError } =
          await getSupabaseAdmin().auth.admin.generateLink({
            type: "email_change_new",
            email: email,
            newEmail: newEmail,
          });

        if (generateError) {
          const emailExists = generateError.code === "email_exists";
          throw new ShelfError({
            cause: generateError,
            ...(emailExists && { title: "Email is already taken." }),
            message: emailExists
              ? "Please choose a different email address which is not already in use."
              : "Failed to initiate email change",
            additionalData: { userId, newEmail },
            label: "Auth",
            shouldBeCaptured: !emailExists,
          });
        }

        // Send email with OTP using our email service
        sendEmail({
          to: newEmail,
          subject: `🔐 Shelf verification code: ${linkData.properties.email_otp}`,
          text: changeEmailAddressTextEmail({
            otp: linkData.properties.email_otp,
            user,
          }),
          html: changeEmailAddressHtmlEmail(
            linkData.properties.email_otp,
            user
          ),
        });

        sendNotification({
          title: "Email update initiated",
          message: "Please check your email for a confirmation code",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(
          data({
            awaitingOtp: true,
            newEmail, // We'll need this to show which email we're waiting for verification
            success: true,
          })
        );
      }
      case "verifyEmailChange": {
        if (payload.type !== "verifyEmailChange")
          throw new Error("Invalid payload type");

        const { otp, email: newEmail } = payload;

        /** Just to make sure the user exists */
        await getUserByID(userId);

        // Attempt to verify the OTP
        const { error: verifyError } = await getSupabaseAdmin().auth.verifyOtp({
          email: newEmail,
          token: otp,
          type: "email_change",
        });

        if (verifyError) {
          throw new ShelfError({
            cause: verifyError,
            message: "Invalid or expired verification code",
            additionalData: { userId },
            label: "Auth",
          });
        }

        /** Update the user's email */
        await updateUserEmail({ userId, currentEmail: email, newEmail });

        /** Refresh the session so it has the up-to-date email */
        const { refreshToken } = authSession;
        const newSession = await refreshAccessToken(refreshToken);
        context.setSession(newSession);
        /** Destroy all other sessions */
        await getSupabaseAdmin().auth.admin.signOut(
          newSession.accessToken,
          "others"
        );

        sendNotification({
          title: "Email updated",
          message: "Your email has been successfully updated",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return json(
          data({ success: true, awaitingOtp: false, emailChanged: true })
        );
      }
      default: {
        checkExhaustiveSwitch(intent);
        return json(data(null));
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}

export function loader() {
  const title = "Account Details";

  return json(data({ title }));
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  breadcrumb: () => "General",
};

export default function UserPage() {
  const zo = useZorm("NewQuestionWizardScreen", UpdateFormSchema);
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const data = useActionData<typeof action>();
  const user = useUserData() as unknown as User;
  const usernameError =
    getValidationErrors<typeof UpdateFormSchema>(data?.error)?.username
      ?.message || zo.errors.username()?.message;
  const fileError = useAtomValue(fileErrorAtom);
  const [, validateFile] = useAtom(validateFileAtom);

  return (
    <div className="mb-2.5 flex flex-col justify-between bg-white md:rounded md:border md:border-gray-200 md:px-6 md:py-5">
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
          className="border-t"
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
          className="relative"
          required={zodFieldIsRequired(
            UpdateFormSchema.shape.email._def.schema
          )}
        >
          {/* Actial field used for resetting pwd and updating user */}
          <input
            type="hidden"
            name={zo.fields.email()}
            value={user?.email}
            className="hidden w-full"
          />
          {/* Just previews the email address */}
          <Input
            label={zo.fields.email()}
            icon="mail"
            hideLabel={true}
            placeholder="zaans@huisje.com"
            type="text"
            value={user?.email}
            className="w-full"
            disabled={true}
            title="To change your email address, please contact support."
            required={zodFieldIsRequired(
              UpdateFormSchema.shape.email._def.schema
            )}
          />
          <ChangeEmailForm currentEmail={user?.email} />
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
                accept={ACCEPT_SUPPORTED_IMAGES}
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
          <input type="hidden" name="type" value="updateUser" />
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

      <div className="my-6">
        <h3 className="text-text-lg font-semibold">Delete account</h3>
        <p className="text-sm text-gray-600">
          Send a request to delete your account.
        </p>
        <RequestDeleteUser />
      </div>
    </div>
  );
}
