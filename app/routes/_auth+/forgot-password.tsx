import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useNavigation } from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { db } from "~/database";

import { getAuthSession, sendResetPasswordLink } from "~/modules/auth";
import { assertIsPost, isFormProcessing, tw, validEmail } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  const title = "Forgot password?";
  const subHeading = "No worries, we’ll send you reset instructions.";

  if (authSession) return redirect("/");

  return json({ title, subHeading });
}

const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .transform((email) => email.toLowerCase())
    .refine(validEmail, () => ({
      message: "Please enter a valid email",
    })),
});

export async function action({ request }: ActionFunctionArgs) {
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
        success: false,
      },
      { status: 400 }
    );
  }

  const { email } = result.data;

  /** We are going to get the user to make sure it exists and is confirmed
   * this will not allow the user to use the forgot password before they have confirmed their email
   */
  const user = await db.user.findFirst({ where: { email } });
  if (!user) {
    return json(
      {
        message:
          "The user with this email is not confirmed yet, so you cannot reset it's password. Please confirm your user before continuing",
        email: null,
        success: false,
      },
      { status: 400 }
    );
  }

  const { error } = await sendResetPasswordLink(email);

  if (error) {
    return json(
      {
        message: "Unable to send password reset link",
        email: null,
        success: false,
      },
      { status: 500 }
    );
  }

  return json({ message: null, email, success: true });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
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
        {!actionData?.success ? (
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
