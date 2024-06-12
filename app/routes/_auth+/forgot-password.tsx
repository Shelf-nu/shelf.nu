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
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { db } from "~/database/db.server";

import { sendResetPasswordLink } from "~/modules/auth/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { data, error, getActionMethod, parseData } from "~/utils/http.server";
import { validEmail } from "~/utils/misc";
import { tw } from "~/utils/tw";

const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .transform((email) => email.toLowerCase())
    .refine(validEmail, () => ({
      message: "Please enter a valid email",
    })),
});
export function loader({ context }: LoaderFunctionArgs) {
  const title = "Forgot password?";
  const subHeading = "No worries, we’ll send you reset instructions.";

  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  return json(data({ title, subHeading }));
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
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

export default function ForgotPassword() {
  const zo = useZorm("ForgotPasswordForm", ForgotPasswordSchema);
  const actionData = useActionData<typeof action>();
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const error = zo.errors.email()?.message || actionData?.error?.message || "";

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        {!actionData || actionData.error ? (
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
            <span className="font-semibold">{actionData.email}</span>
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
