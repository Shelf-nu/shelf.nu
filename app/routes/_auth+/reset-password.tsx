import { useEffect, useState } from "react";

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";

import PasswordInput from "~/components/forms/password-input";
import { Button } from "~/components/shared/button";
import { supabaseClient } from "~/integrations/supabase";

import {
  commitAuthSession,
  getAuthSession,
  refreshAccessToken,
  updateAccountPassword,
} from "~/modules/auth";
import { assertIsPost, isFormProcessing, tw } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  const title = "Set new password";
  const subHeading =
    "Your new password must be different to previously used passwords.";

  if (authSession) return redirect("/");

  return json({ title, subHeading });
}

const ResetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password is too short. Minimum 8 characters."),
    confirmPassword: z
      .string()
      .min(8, "Password is too short. Minimum 8 characters."),
    refreshToken: z.string(),
  })
  .superRefine(({ password, confirmPassword, refreshToken }, ctx) => {
    if (password !== confirmPassword) {
      return ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password and confirm password must match",
        path: ["confirmPassword"],
      });
    }

    return { password, confirmPassword, refreshToken };
  });

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);

  const formData = await request.formData();
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

  const { password, refreshToken } = result.data;

  const authSession = await refreshAccessToken(refreshToken);

  if (!authSession) {
    return json(
      {
        message:
          "Invalid refresh token. Please try again. If the issue persists, contact support",
      },
      { status: 401 }
    );
  }

  const user = await updateAccountPassword(authSession.userId, password);

  if (!user) {
    return json(
      {
        message: "Issue updating passowrd",
      },
      { status: 500 }
    );
  }

  return redirect("/", {
    headers: {
      "Set-Cookie": await commitAuthSession(request, {
        authSession,
      }),
    },
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function ResetPassword() {
  const zo = useZorm("ResetPasswordForm", ResetPasswordSchema);
  const [userRefreshToken, setUserRefreshToken] = useState("");
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabaseClient.auth.onAuthStateChange((event, supabaseSession) => {
      // In local development, we doesn't see "PASSWORD_RECOVERY" event because:
      // Effect run twice and break listener chain
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        const refreshToken = supabaseSession?.refresh_token;

        if (!refreshToken) return;

        setUserRefreshToken(refreshToken);
      }
    });

    return () => {
      // prevent memory leak. Listener stays alive 👨‍🎤
      subscription.unsubscribe();
    };
  }, [setUserRefreshToken]);

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        <Form ref={zo.ref} method="post" className="space-y-6" replace>
          <PasswordInput
            label="Password"
            data-test-id="password"
            name={zo.fields.password()}
            type="password"
            autoComplete="new-password"
            disabled={disabled}
            error={zo.errors.password()?.message}
          />
          <PasswordInput
            label="Confirm password"
            data-test-id="confirmPassword"
            name={zo.fields.confirmPassword()}
            type="password"
            autoComplete="new-password"
            disabled={disabled}
            error={zo.errors.confirmPassword()?.message}
          />

          <input
            type="hidden"
            name={zo.fields.refreshToken()}
            value={userRefreshToken}
          />
          <Button
            data-test-id="change-password"
            type="submit"
            className="w-full "
            disabled={disabled}
          >
            Change password
          </Button>
        </Form>
        {actionData?.message ? (
          <div className="flex flex-col items-center">
            <div className={tw(`mb-2 h-6 text-center text-red-600`)}>
              {actionData.message}
            </div>
            <Button
              variant="link"
              className="text-blue-500 underline"
              to="/forgot-password"
            >
              Resend link
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
