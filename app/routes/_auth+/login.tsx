import * as React from "react";

import type { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  Form,
  Link,
  useActionData,
  useSearchParams,
  useTransition,
} from "@remix-run/react";
import { parseFormAny, useZorm } from "react-zorm";
import { z } from "zod";

import Input from "~/components/forms/input";
import {
  createAuthSession,
  getAuthSession,
  signInWithEmail,
  ContinueWithEmailForm,
} from "~/modules/auth";
import { assertIsPost, isFormProcessing } from "~/utils";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);

  if (authSession) return redirect("/items");
  return null;
}

const LoginFormSchema = z.object({
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
  /** Check the zo validations */
  const result = await LoginFormSchema.safeParseAsync(parseFormAny(formData));

  /** If there are some zo validation errors, show them */
  if (!result.success) {
    return json(
      {
        errors: result.error,
      },
      { status: 400 }
    );
  }

  const { email, password, redirectTo } = result.data;

  const authSession = await signInWithEmail(email, password);

  if (!authSession) {
    return json(
      {
        errors: {
          email:
            "Wrong password. Forgot your password? Use the magic link below.",
          password: null,
        },
      },
      { status: 400 }
    );
  }

  return createAuthSession({
    request,
    authSession,
    redirectTo: redirectTo || "/items",
  });
}

export default function IndexLoginForm() {
  const zo = useZorm("NewQuestionWizardScreen", LoginFormSchema);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const data = useActionData<{
    errors: { email: string; password: string | null };
  }>();

  const transition = useTransition();
  const disabled = isFormProcessing(transition.state);

  return (
    <main className="relative flex min-h-screen items-center px-10">
      <div className="grid h-full grid-cols-2 gap-4">
        <div className="">
          <img
            src="/images/cover.jpg"
            alt="MidJourney generated shelf"
            className="h-full"
          />
        </div>
        <div className="flex flex-col justify-center text-center">
          <div className="flex flex-col justify-center">
            <div className="mx-auto w-full max-w-md px-8">
              <Form ref={zo.ref} method="post" className="space-y-6" replace>
                <div>
                  <label
                    htmlFor={zo.fields.email()}
                    className="block text-sm font-medium text-gray-700"
                  >
                    Email address
                  </label>

                  <div className="mt-1">
                    <Input
                      data-test-id="email"
                      required
                      autoFocus={true}
                      name={zo.fields.email()}
                      type="email"
                      autoComplete="email"
                      className="w-full"
                      disabled={disabled}
                      error={zo.errors.email()?.message}
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor={zo.fields.password()}
                    className="block text-sm font-medium text-gray-700"
                  >
                    Password
                  </label>
                  <div className="mt-1">
                    <Input
                      data-test-id="password"
                      name={zo.fields.password()}
                      type="password"
                      autoComplete="new-password"
                      className="w-full rounded border border-gray-500 px-2 py-1 text-lg"
                      disabled={disabled}
                      error={
                        zo.errors.password()?.message || data?.errors?.email
                      }
                    />
                  </div>
                </div>

                <input
                  type="hidden"
                  name={zo.fields.redirectTo()}
                  value={redirectTo}
                />
                <button
                  data-test-id="login"
                  type="submit"
                  className="w-full rounded bg-blue-500 py-2 px-4 text-white focus:bg-blue-400 hover:bg-blue-600"
                  disabled={disabled}
                >
                  Log in
                </button>
                <div className="flex flex-col items-center justify-center">
                  <div className="text-center text-sm text-gray-500">
                    Don't have an account?{" "}
                    <Link
                      className="text-blue-500 underline"
                      data-test-id="signupButton"
                      to={{
                        pathname: "/join",
                        search: searchParams.toString(),
                      }}
                    >
                      Sign up
                    </Link>
                  </div>
                  <div className="text-center text-sm text-gray-500">
                    Don't remember your passwor?{" "}
                    <Link
                      className="text-blue-500 underline"
                      to={{
                        pathname: "/forgot-password",
                        search: searchParams.toString(),
                      }}
                    >
                      Reset password
                    </Link>
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
          </div>
        </div>
      </div>
    </main>
  );
}
