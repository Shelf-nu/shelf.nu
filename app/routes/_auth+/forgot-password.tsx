import type { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";

import { getAuthSession, sendResetPasswordLink } from "~/modules/auth";
import { assertIsPost, isFormProcessing, tw } from "~/utils";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const title = "Forgot password";

  if (authSession) return redirect("/items");

  return json({ title });
}

const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .email("invalid-email")
    .transform((email) => email.toLowerCase()),
});

export async function action({ request }: ActionArgs) {
  assertIsPost(request);

  const formData = await request.formData();
  const result = await ForgotPasswordSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json(
      {
        message: "invalid-request",
      },
      { status: 400 }
    );
  }

  const { email } = result.data;

  const { error } = await sendResetPasswordLink(email);

  if (error) {
    return json(
      {
        message: "Unable to send password reset link",
      },
      { status: 500 }
    );
  }

  return json({ message: null });
}

export default function ForgotPassword() {
  const zo = useZorm("ForgotPasswordForm", ForgotPasswordSchema);
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        {!actionData ? (
          <Form ref={zo.ref} method="post" className="space-y-6" replace>
            <div>
              <label
                htmlFor={zo.fields.email()}
                className="block text-sm font-medium text-gray-700"
              >
                Email address
              </label>
              <div className="mt-1">
                <input
                  data-test-id="email"
                  name={zo.fields.email()}
                  type="email"
                  autoComplete="email"
                  className="w-full rounded border border-gray-500 px-2 py-1 text-lg"
                  disabled={disabled}
                />
                {zo.errors.email()?.message && (
                  <div className="pt-1 text-red-700" id="password-error">
                    {zo.errors.email()?.message}
                  </div>
                )}
              </div>
            </div>

            <button
              data-test-id="send-password-reset-link"
              type="submit"
              className="w-full rounded bg-blue-500  py-2 px-4 text-white focus:bg-blue-400 hover:bg-blue-600"
              disabled={disabled}
            >
              Send me a link
            </button>
          </Form>
        ) : (
          <div
            className={tw(
              `mb-2 h-6 text-center`,
              actionData.message ? "text-red-600" : "text-green-600"
            )}
          >
            {actionData.message || "Check your emails ✌️"}
          </div>
        )}
      </div>
    </div>
  );
}
