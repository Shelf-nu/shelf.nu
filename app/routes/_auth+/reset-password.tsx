import { useEffect, useState } from "react";

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useActionData, useNavigation } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { Form } from "~/components/custom-form";

import PasswordInput from "~/components/forms/password-input";
import { Button } from "~/components/shared/button";
import { supabaseClient } from "~/integrations/supabase/client";

import {
  refreshAccessToken,
  updateAccountPassword,
} from "~/modules/auth/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getActionMethod, parseData } from "~/utils/http.server";
import { tw } from "~/utils/tw";

export function loader({ context }: LoaderFunctionArgs) {
  const title = "Set new password";
  const subHeading =
    "Your new password must be different to previously used passwords.";

  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  return json(data({ title, subHeading }));
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

export async function action({ context, request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { password, refreshToken } = parseData(
          await request.formData(),
          ResetPasswordSchema
        );

        const authSession = await refreshAccessToken(refreshToken);

        await updateAccountPassword(
          authSession.userId,
          password,
          authSession.accessToken
        );
        context.destroySession();
        return redirect("/login?password_reset=true");
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
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
        {actionData?.error.message ? (
          <div className="flex flex-col items-center">
            <div className={tw(`mb-2 h-6 text-center text-red-600`)}>
              {actionData.error.message}
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
