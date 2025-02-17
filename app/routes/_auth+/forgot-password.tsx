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
import { ShelfOTP } from "~/components/forms/otp-input";
import PasswordInput from "~/components/forms/password-input";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
import { getSupabaseAdmin } from "~/integrations/supabase/client";

import {
  sendResetPasswordLink,
  updateAccountPassword,
} from "~/modules/auth/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  data,
  error,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
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

export function loader({ context, request }: LoaderFunctionArgs) {
  const searchParams = getCurrentSearchParams(request);

  const title = "Forgot password?";
  const subHeading =
    searchParams.has("email") && searchParams.get("email") !== ""
      ? "Step 2 of 2: Enter OTP and your new password"
      : "Step 1 of 2: Enter your email";

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

        return redirect("/forgot-password?email=" + email);
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
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") || "";
  const emailError =
    zo.errors.email()?.message || actionData?.error?.message || "";
  const disabled = useDisabled();

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full">
        {actionData?.error || !email || email === "" ? (
          <div>
            <p className="mb-4 text-center">
              Enter your email address and we'll send you a one-time code to
              reset your password.
            </p>
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
            <p className="mt-2 text-center text-gray-500">
              Tip: Check your spam folder if you don't see the email within a
              few minutes.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-2">
              We've sent a 6-digit code to{" "}
              <span className="font-semibold">{email}</span>.
            </p>
            <ol className="mb-4 list-inside list-decimal">
              <li>Enter the code from your email</li>
              <li>Enter your new password</li>
              <li>Confirm your new password</li>
            </ol>
            <PasswordResetForm email={email} />
          </>
        )}
        <div className="pt-4 text-center">
          {email ? (
            <Button variant="link" to={"/forgot-password"}>
              Request new code
            </Button>
          ) : (
            <Button variant="link" to={"/login"}>
              Back to login
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PasswordResetForm({ email }: { email: string }) {
  const zoReset = useZorm("ResetPasswordForm", OtpSchema);
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();
  return !email || email === "" || actionData?.error ? (
    <div>Something went wrong. Please refresh the page and try again.</div>
  ) : (
    <Form method="post" ref={zoReset.ref} className="space-y-2">
      <ShelfOTP error={zoReset.errors.otp()?.message} />

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

      <input type="hidden" name="email" value={email} />
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
