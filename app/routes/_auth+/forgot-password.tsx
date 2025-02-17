import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import Input from "~/components/forms/input";
import PasswordInput from "~/components/forms/password-input";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useDisabled } from "~/hooks/use-disabled";
import { getSupabaseAdmin } from "~/integrations/supabase/client";

import {
  sendResetPasswordLink,
  updateAccountPassword,
} from "~/modules/auth/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { validEmail } from "~/utils/misc";

const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .transform((email) => email.toLowerCase())
    .refine(validEmail, () => ({
      message: "Please enter a valid email",
    })),
});

const OtpSchema = z
  .object({
    otp: z.string().min(6, "OTP is required."),
    email: z.string().transform((email) => email.toLowerCase()),
    password: z.string().min(8, "Password is too short. Minimum 8 characters."),
    confirmPassword: z
      .string()
      .min(8, "Password is too short. Minimum 8 characters."),
  })
  .superRefine(({ password, confirmPassword, otp, email }, ctx) => {
    if (password !== confirmPassword) {
      return ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password and confirm password must match",
        path: ["confirmPassword"],
      });
    }

    return { password, confirmPassword, otp, email };
  });

export function loader({ context }: LoaderFunctionArgs) {
  const title = "Forgot password?";
  const subHeading = "No worries, we’ll send you reset instructions.";

  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  return json(data({ title, subHeading }));
}

export async function action({ request, context }: ActionFunctionArgs) {
  try {
    const { intent } = parseData(
      await request.clone().formData(),
      z.object({ intent: z.enum(["request-otp", "confirm-otp"]) }),
      {
        message:
          "Invalid request. Please try again. If the issue persists, contact support.",
      }
    );

    switch (intent) {
      case "request-otp": {
        const { email } = parseData(
          await request.formData(),
          ForgotPasswordSchema
        );

        /** We are going to get the user to make sure it exists and is confirmed
         * this will not allow the user to use the forgot password before they have confirmed their email
         */
        const user = await db.user.findFirst({ where: { email } });

        if (!user) {
          throw new ShelfError({
            cause: null,
            message:
              "The user with this email is not confirmed yet, so you cannot reset it's password. Please confirm your user before continuing",
            additionalData: { email },
            shouldBeCaptured: false,
            label: "Auth",
          });
        }

        if (user.sso) {
          throw new ShelfError({
            cause: null,
            message:
              "This user is an SSO user and cannot reset password using email.",
            additionalData: { email },
            shouldBeCaptured: false,
            label: "Auth",
          });
        }

        await sendResetPasswordLink(email);

        return json(data({ email }));
      }
      case "confirm-otp": {
        const { email, otp, password } = parseData(
          await request.clone().formData(),
          OtpSchema
        );

        // Attempt to verify the OTP
        const { data: otpData, error: verifyError } =
          await getSupabaseAdmin().auth.verifyOtp({
            email,
            token: otp,
            type: "recovery",
          });

        if (verifyError || !otpData.user || !otpData.session) {
          throw new ShelfError({
            cause: verifyError,
            message: "Invalid or expired verification code",
            additionalData: { email, otp },
            label: "Auth",
          });
        }

        await updateAccountPassword(
          otpData.user.id,
          password,
          otpData.session.access_token
        );

        context.destroySession();
        return redirect("/login?password_reset=true");
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function ForgotPassword() {
  const zo = useZorm("ForgotPasswordForm", ForgotPasswordSchema);

  const actionData = useActionData<typeof action>();

  const emailError =
    zo.errors.email()?.message || actionData?.error?.message || "";
  const disabled = useDisabled();

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full">
        {!actionData || actionData.error ? (
          <Form ref={zo.ref} method="post" className="space-y-2" replace>
            <input type="hidden" name="intent" value="request-otp" />
            <div>
              <Input
                label="Email address"
                data-test-id="email"
                name={zo.fields.email()}
                type="email"
                autoComplete="email"
                inputClassName="w-full"
                placeholder="zaans@huisje.com"
                disabled={disabled}
                error={emailError}
              />
            </div>

            <Button
              data-test-id="send-password-reset-link"
              width="full"
              type="submit"
              disabled={disabled}
            >
              {!disabled ? "Reset password" : "Sending code..."}
            </Button>
          </Form>
        ) : (
          <>
            <p className="mb-2">
              We have sent an OTP to{" "}
              <span className="font-semibold">{actionData.email}</span>. Please
              enter the OTP to reset your password.
            </p>
            <PasswordResetForm />
          </>
        )}
        <div className="pt-4 text-center">
          <Button variant="link" to={"/login"}>
            Back to Log in
          </Button>
        </div>
      </div>
    </div>
  );
}

function PasswordResetForm() {
  const zoReset = useZorm("ResetPasswordForm", OtpSchema);
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();
  return !actionData || actionData.error ? (
    <div>Something went wrong. Please refresh the page and try again.</div>
  ) : (
    <Form method="post" ref={zoReset.ref} className="space-y-2">
      <Input
        name={zoReset.fields.otp()}
        disabled={disabled}
        label="Code"
        required
        placeholder="133734"
        error={zoReset.errors.otp()?.message}
      />
      <PasswordInput
        label="New password"
        data-test-id="password"
        name={zoReset.fields.password()}
        type="password"
        autoComplete="new-password"
        disabled={disabled}
        error={zoReset.errors.password()?.message}
        placeholder="********"
        required
      />
      <PasswordInput
        label="Confirm new password"
        data-test-id="confirmPassword"
        name={zoReset.fields.confirmPassword()}
        type="password"
        autoComplete="new-password"
        disabled={disabled}
        error={zoReset.errors.confirmPassword()?.message}
        placeholder="********"
        required
      />

      <input type="hidden" name="email" value={actionData.email} />
      <input type="hidden" name="intent" value="confirm-otp" />

      <Button
        data-test-id="create-account"
        type="submit"
        className="w-full "
        disabled={disabled}
      >
        Confirm password reset
      </Button>
    </Form>
  );
}
