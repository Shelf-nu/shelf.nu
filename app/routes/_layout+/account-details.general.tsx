import type { Prisma } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";

import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { Card } from "~/components/shared/card";
import { createChangeEmailSchema } from "~/components/user/change-email";
import {
  UserDetailsForm,
  UserDetailsFormSchema,
} from "~/components/user/details-form";
import PasswordResetForm from "~/components/user/password-reset-form";
import { RequestDeleteUser } from "~/components/user/request-delete-user";
import {
  UserContactDetailsForm,
  UserContactDetailsFormSchema,
} from "~/components/user/user-contact-form";
import {
  changeEmailAddressHtmlEmail,
  changeEmailAddressTextEmail,
} from "~/emails/change-user-email-address";

import { sendEmail } from "~/emails/mail.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { refreshAccessToken } from "~/modules/auth/service.server";
import {
  getUserByID,
  getUserWithContact,
  updateProfilePicture,
  updateUser,
  updateUserEmail,
} from "~/modules/user/service.server";
import type { UpdateUserPayload } from "~/modules/user/types";
import type { UpdateUserContactPayload } from "~/modules/user-contact/service.server";
import { updateUserContact } from "~/modules/user-contact/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { delay } from "~/utils/delay";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ADMIN_EMAIL, SERVER_URL } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { getConfiguredSSODomains } from "~/utils/sso.server";

// First we define our intent schema
const IntentSchema = z.object({
  intent: z.enum([
    "resetPassword",
    "updateUser",
    "deleteUser",
    "initiateEmailChange",
    "verifyEmailChange",
    "updateUserContact",
  ]),
});

// Then we define schemas for each intent type
const ActionSchemas = {
  resetPassword: z.object({
    type: z.literal("resetPassword"),
  }),

  updateUser: UserDetailsFormSchema.extend({
    type: z.literal("updateUser"),
  }),

  updateUserContact: UserContactDetailsFormSchema.extend({
    type: z.literal("updateUserContact"),
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

export type UserPageActionData = typeof action;

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId, email } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.userData,
      action: PermissionAction.update,
    });

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

        /** Logout user after 3 seconds */
        await delay(2000);

        context.destroySession();

        return redirect("/forgot-password");
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
      case "updateUserContact": {
        if (payload.type !== "updateUserContact")
          throw new ShelfError({
            cause: null,
            message: "Invalid payload type",
            label: "User",
          });

        const updateUserContactPayload: UpdateUserContactPayload = {
          userId,
          phone: payload.phone,
          street: payload.street,
          city: payload.city,
          stateProvince: payload.stateProvince,
          zipPostalCode: payload.zipPostalCode,
          countryRegion: payload.countryRegion,
        };

        await updateUserContact(updateUserContactPayload);

        sendNotification({
          title: "Contact details updated",
          message: "Your contact information has been updated successfully",
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

        sendEmail({
          to: ADMIN_EMAIL || `"Shelf" <updates@emails.shelf.nu>`,
          subject: "Delete account request",
          text: `User with id ${userId} and email ${payload.email} has requested to delete their account. \n User: ${SERVER_URL}/admin-dashboard/${userId} \n\n Reason: ${reason}\n\n`,
        });

        sendEmail({
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
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          } satisfies Prisma.UserSelect,
        });
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
        await getUserByID(userId, {
          select: { id: true } satisfies Prisma.UserSelect,
        });

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

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.userData,
      action: PermissionAction.read,
    });

    const title = "Account Details";
    const user = await getUserWithContact(userId);

    return json(data({ title, user }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  breadcrumb: () => "General",
};

export default function UserPage() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <div className="mb-2.5 flex flex-col justify-between gap-3">
      <UserDetailsForm user={user} />
      <UserContactDetailsForm user={user} />
      {!user.sso && (
        <>
          <Card className="my-0">
            <div className="mb-6">
              <h3 className="text-text-lg font-semibold">Password</h3>
              <p className="text-sm text-gray-600">
                Update your password here.
              </p>
            </div>
            <div>
              <p>Need to reset your password?</p>
              <p>
                Click below to start the reset process. You'll be logged out and
                redirected to our password reset page.
              </p>
            </div>
            <PasswordResetForm />
          </Card>
          <Card className="my-0">
            <h3 className="text-text-lg font-semibold">Delete account</h3>
            <p className="text-sm text-gray-600">
              Send a request to delete your account.
            </p>
            <RequestDeleteUser />
          </Card>
        </>
      )}
    </div>
  );
}
