import * as React from "react";
import type {
  LoaderFunctionArgs,
  ActionFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import {
  Form,
  useActionData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";

import Input from "~/components/forms/input";
import PasswordInput from "~/components/forms/password-input";
import { Button } from "~/components/shared/button";
import { getAuthSession, ContinueWithEmailForm } from "~/modules/auth";
import { signUpWithEmailPass } from "~/modules/auth/service.server";
import { getUserByEmail } from "~/modules/user";
import { assertIsPost, isFormProcessing } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);

  const title = "Create an account";

  const subHeading = "Start your journey with Shelf";

  if (authSession) return redirect("/");

  return json({ title, subHeading });
}

const JoinFormSchema = z
  .object({
    email: z
      .string()
      .email("invalid-email")
      .transform((email) => email.toLowerCase()),
    password: z.string().min(8, "password-too-short"),
    confirmPassword: z.string().min(8, "password-too-short"),
    redirectTo: z.string().optional(),
  })
  .superRefine(({ password, confirmPassword }, ctx) => {
    if (password !== confirmPassword) {
      return ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password and confirm password must match",
        path: ["confirmPassword"],
      });
    }
  });

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();
  const result = await JoinFormSchema.safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      { status: 400 }
    );
  }

  const { email, password } = result.data;

  const existingUser = await getUserByEmail(email);

  if (existingUser) {
    return json(
      {
        errors: {
          email: "User with this Email already exits, login instead",
          password: null,
        },
      },
      { status: 400 }
    );
  }

  // Sign up with the provided email and password
  const signUpResult = await signUpWithEmailPass(email, password);

  // Handle the results of the sign up
  if (signUpResult.status === "error") {
    return json(
      { errors: { email: "unable-to-create-account", password: null } },
      { status: 500 }
    );
  } else if (
    signUpResult.user?.confirmation_sent_at ||
    signUpResult.status === "Email verification_required"
  ) {
    // Redirect to the email verification page using Remix's redirect function
    return redirect(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return json(
    {
      errors: {
        email: "Somthing Went Wrong, refresh page and try to signup again ",
        password: null,
      },
    },
    { status: 500 }
  );
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function Join() {
  const zo = useZorm("NewQuestionWizardScreen", JoinFormSchema);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  const data = useActionData<{
    errors: { email: string; password: string | null };
  }>();

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        <Form ref={zo.ref} method="post" className="space-y-6" replace>
          <div>
            <Input
              data-test-id="email"
              label="Email address"
              placeholder="zaans@huisje.com"
              required
              autoFocus={true}
              name={zo.fields.email()}
              type="email"
              autoComplete="email"
              disabled={disabled}
              inputClassName="w-full"
              error={zo.errors.email()?.message || data?.errors?.email}
            />
          </div>

          <PasswordInput
            label="Password"
            placeholder="**********"
            required
            data-test-id="password"
            name={zo.fields.password()}
            autoComplete="new-password"
            disabled={disabled}
            inputClassName="w-full"
            error={zo.errors.password()?.message}
          />
          <PasswordInput
            label="Confirm Password"
            placeholder="**********"
            required
            data-test-id="confirmPassword"
            name={zo.fields.confirmPassword()}
            autoComplete="new-password"
            disabled={disabled}
            inputClassName="w-full"
            error={zo.errors.confirmPassword()?.message}
          />

          <input
            type="hidden"
            name={zo.fields.redirectTo()}
            value={redirectTo}
          />
          <Button
            className="text-center"
            type="submit"
            data-test-id="login"
            disabled={disabled}
            width="full"
          >
            Get Started
          </Button>
        </Form>
        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-2 text-gray-500">
                {"Or use a Magic Link"}
              </span>
            </div>
          </div>
          <div className="mt-6">
            <ContinueWithEmailForm />
          </div>
        </div>
        <div className="flex items-center justify-center pt-5">
          <div className="text-center text-sm text-gray-500">
            {"Already have an account? "}
            <Button
              variant="link"
              to={{
                pathname: "/",
                search: searchParams.toString(),
              }}
            >
              Log in
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
