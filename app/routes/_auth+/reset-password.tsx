import { useEffect, useMemo, useState } from "react";

import type { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, Link, useActionData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";

import { getSupabase } from "~/integrations/supabase";
import {
  commitAuthSession,
  getAuthSession,
  refreshAccessToken,
  updateAccountPassword,
} from "~/modules/auth";
import { assertIsPost, isFormProcessing, tw } from "~/utils";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const title = "Change password";

  if (authSession) return redirect("/items");

  return json({ title });
}

const ResetPasswordSchema = z
  .object({
    password: z.string().min(8, "Passowrd is too short. Minimum 8 characters."),
    confirmPassword: z
      .string()
      .min(8, "Passowrd is too short. Minimum 8 characters."),
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

export async function action({ request }: ActionArgs) {
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

  return redirect("/items", {
    headers: {
      "Set-Cookie": await commitAuthSession(request, {
        authSession,
      }),
    },
  });
}

export default function ResetPassword() {
  const zo = useZorm("ResetPasswordForm", ResetPasswordSchema);
  const [userRefreshToken, setUserRefreshToken] = useState("");
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const supabase = useMemo(() => getSupabase(), []);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, supabaseSession) => {
      if (event === "SIGNED_IN") {
        const refreshToken = supabaseSession?.refresh_token;

        if (!refreshToken) return;

        setUserRefreshToken(refreshToken);
      }
    });

    return () => {
      // prevent memory leak. Listener stays alive 👨‍🎤
      subscription.unsubscribe();
    };
  }, [supabase.auth]);

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        <Form ref={zo.ref} method="post" className="space-y-6" replace>
          <div>
            <label
              htmlFor={zo.fields.password()}
              className="block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <div className="mt-1">
              <input
                data-test-id="password"
                name={zo.fields.password()}
                type="password"
                autoComplete="new-password"
                className="w-full rounded border border-gray-500 px-2 py-1 text-lg"
                disabled={disabled}
              />
              {zo.errors.password()?.message && (
                <div className="pt-1 text-red-700" id="password-error">
                  {zo.errors.password()?.message}
                </div>
              )}
            </div>
          </div>
          <div>
            <label
              htmlFor={zo.fields.confirmPassword()}
              className="block text-sm font-medium text-gray-700"
            >
              Confirm password
            </label>
            <div className="mt-1">
              <input
                data-test-id="confirmPassword"
                name={zo.fields.confirmPassword()}
                type="password"
                autoComplete="new-password"
                className="w-full rounded border border-gray-500 px-2 py-1 text-lg"
                disabled={disabled}
              />
              {zo.errors.confirmPassword()?.message && (
                <div className="pt-1 text-red-700" id="password-error">
                  {zo.errors.confirmPassword()?.message}
                </div>
              )}
            </div>
          </div>

          <input
            type="hidden"
            name={zo.fields.refreshToken()}
            value={userRefreshToken}
          />
          <button
            data-test-id="change-password"
            type="submit"
            className="w-full rounded bg-blue-500  py-2 px-4 text-white focus:bg-blue-400 hover:bg-blue-600"
            disabled={disabled}
          >
            Change password
          </button>
        </Form>
        {actionData?.message ? (
          <div className="flex flex-col items-center">
            <div className={tw(`mb-2 h-6 text-center text-red-600`)}>
              {actionData.message}
            </div>
            <Link className="text-blue-500 underline" to="/forgot-password">
              Resend link
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
