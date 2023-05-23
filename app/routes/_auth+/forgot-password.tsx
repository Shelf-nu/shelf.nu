import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

import { getAuthSession, sendResetPasswordLink } from "~/modules/auth";
import { assertIsPost, isFormProcessing, tw } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const title = "Forgot password?";
  const subHeading = "No worries, we’ll send you reset instructions.";

  if (authSession) return redirect("/assets");

  return json({ title, subHeading });
}

const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid Email address")
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
        message: "Invalid request",
        email: null,
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
        email: null,
      },
      { status: 500 }
    );
  }

  return json({ message: null, email });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.title) },
];

export default function ForgotPassword() {
  const zo = useZorm("ForgotPasswordForm", ForgotPasswordSchema);
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const error = zo.errors.email()?.message || actionData?.message || "";

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        {!actionData ? (
          <Form ref={zo.ref} method="post" className="space-y-6" replace>
            <div>
              <Input
                label="Email address"
                data-test-id="email"
                name={zo.fields.email()}
                type="email"
                autoComplete="email"
                inputClassName="w-full"
                disabled={disabled}
                error={error}
              />
            </div>

            <Button
              data-test-id="send-password-reset-link"
              width="full"
              type="submit"
              disabled={disabled}
            >
              {!disabled ? "Reset password" : "Sending link..."}
            </Button>
          </Form>
        ) : (
          <div className={tw(`mb-2 h-6 text-center text-gray-600`)}>
            We sent a password reset link to{" "}
            <span className="font-semibold">{actionData?.email}</span>
          </div>
        )}
        <div className="mt-8 text-center">
          <Button variant="link" to={"/login"}>
            Back to Log in
          </Button>
        </div>
      </div>
    </div>
  );
}
