import * as React from "react";

import type { ActionArgs, LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import {
  Form,
  useActionData,
  useSearchParams,
  useTransition,
} from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";

import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

import {
  createAuthSession,
  getAuthSession,
  ContinueWithEmailForm,
} from "~/modules/auth";
import { getUserByEmail, createUserAccount } from "~/modules/user";
import {
  assertIsPost,
  isFormProcessing,
  randomUsernameFromEmail,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const title = "Create an account";
  const subHeading = "Start your journey with Shelf";

  if (authSession) return redirect("/");

  return json({ title, subHeading });
}

const JoinFormSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email.")
    .transform((email) => email.toLowerCase()),
  password: z.string().min(8, "Password is too short. Minimum 8 characters."),
  redirectTo: z.string().optional(),
});

export async function action({ request }: ActionArgs) {
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

  const { email, password, redirectTo } = result.data;

  const existingUser = await getUserByEmail(email);

  if (existingUser) {
    return json(
      {
        errors: {
          email: "User with this email already exists.",
          password: null,
        },
      },
      { status: 400 }
    );
  }

  const username = randomUsernameFromEmail(email);
  const authSession = await createUserAccount(email, password, username);

  if (!authSession) {
    return json(
      {
        errors: {
          email: "Unable to create account. Please contact support.",
          password: null,
        },
      },
      { status: 500 }
    );
  }

  return createAuthSession({
    request,
    authSession,
    redirectTo: redirectTo || "/items",
  });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data.title) },
];

export default function Join() {
  const zo = useZorm("NewQuestionWizardScreen", JoinFormSchema);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const transition = useTransition();
  const disabled = isFormProcessing(transition.state);
  const data = useActionData<{
    errors: { email: string; password: string | null };
  }>();
  const emailErrorMessage: string | undefined =
    zo.errors.email()?.message || data?.errors.email;

  return (
    <div className="w-full max-w-md">
      <Form ref={zo.ref} method="post" className="flex flex-col gap-5" replace>
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
            inputClassName="w-full"
            disabled={disabled}
            error={emailErrorMessage}
          />
        </div>

        <div>
          <Input
            label="Password"
            placeholder="********"
            data-test-id="password"
            name={zo.fields.password()}
            type="password"
            autoComplete="new-password"
            inputClassName="w-full"
            disabled={disabled}
            error={zo.errors.password()?.message}
          />
        </div>

        <input type="hidden" name={zo.fields.redirectTo()} value={redirectTo} />
        <Button data-test-id="create-account" type="submit" disabled={disabled}>
          Create Account
        </Button>
        <div className="flex items-center justify-center">
          <div className="text-center text-sm text-gray-500">
            Already have an account?{" "}
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
      </Form>
      <div className="mt-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-gray-500">
              Or Sign Up with a <strong>Magic Link</strong>
            </span>
          </div>
        </div>
        <div className="mt-6">
          <ContinueWithEmailForm />
        </div>
      </div>
    </div>
  );
}
