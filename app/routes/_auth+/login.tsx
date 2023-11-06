import * as React from "react";

import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
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

import {
  getAuthSession,
  signInWithEmail,
  ContinueWithEmailForm,
  commitAuthSession,
} from "~/modules/auth";
import { getOrganizationByUserId } from "~/modules/organization";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import {
  assertIsPost,
  isFormProcessing,
  safeRedirect,
  validEmail,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);
  const title = "Log in";
  const subHeading = "Welcome back! Enter your details below to log in.";

  if (authSession) return redirect(`/`);
  return json({ title, subHeading });
}

const LoginFormSchema = z.object({
  email: z
    .string()
    .transform((email) => email.toLowerCase())
    .refine(validEmail, () => ({
      message: "Please enter a valid email",
    })),
  password: z.string().min(8, "Password is too short. Minimum 8 characters."),
  redirectTo: z.string().optional(),
});

export async function action({ request }: ActionFunctionArgs) {
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

  const signInResult = await signInWithEmail(email, password);

  if (
    signInResult.status === "error" &&
    signInResult.message === "Email not confirmed"
  ) {
    return redirect(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  if (
    signInResult.status === "error" &&
    signInResult.message === "Invalid login credentials"
  ) {
    return json(
      {
        errors: {
          email: null,
          password: "incorrect Username and password",
        },
      },
      { status: 400 }
    );
  }

  if (signInResult.status === "error") {
    return json(
      {
        errors: {
          email: signInResult.message,
          password: null,
        },
      },
      { status: 400 }
    );
  }

  // Ensure that user property exists before proceeding
  if (signInResult.status === "success" && signInResult.authSession) {
    const { authSession } = signInResult;
    const personalOrganization = await getOrganizationByUserId({
      userId: authSession.userId,
      orgType: "PERSONAL",
    });

    return redirect(safeRedirect(redirectTo || "/"), {
      headers: [
        setCookie(
          await setSelectedOrganizationIdCookie(personalOrganization.id)
        ),
        setCookie(
          await commitAuthSession(request, {
            authSession,
            flashErrorMessage: null,
          })
        ),
      ],
    });
  }

  // Handle any unexpected scenarios
  return json(
    {
      errors: {
        email: "Something went wrong. Please try again later.",
        password: null,
      },
    },
    { status: 500 }
  );
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function IndexLoginForm() {
  const zo = useZorm("NewQuestionWizardScreen", LoginFormSchema);
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? undefined;
  const acceptedInvite = searchParams.get("acceptedInvite");
  const data = useActionData<{
    errors: { email: string; password: string };
  }>();

  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <div className="w-full max-w-md">
      {acceptedInvite ? (
        <div className="mb-8 text-center text-success-600">
          Successfully accepted workspace invite. Please login to see your new
          workspace.
        </div>
      ) : null}
      <Form ref={zo.ref} method="post" replace className="flex flex-col gap-5">
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
          data-test-id="password"
          name={zo.fields.password()}
          autoComplete="new-password"
          disabled={disabled}
          inputClassName="w-full"
          error={zo.errors.password()?.message || data?.errors?.password}
        />

        <input type="hidden" name={zo.fields.redirectTo()} value={redirectTo} />
        <Button
          className="text-center"
          type="submit"
          data-test-id="login"
          disabled={disabled}
        >
          Log In
        </Button>
        <div className="flex flex-col items-center justify-center">
          <div className="text-center text-sm text-gray-500">
            Don't remember your password?{" "}
            <Button
              variant="link"
              to={{
                pathname: "/forgot-password",
                search: searchParams.toString(),
              }}
            >
              Reset password
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
              Or use a <strong>Magic Link</strong>
            </span>
          </div>
        </div>
        <div className="mt-6">
          <ContinueWithEmailForm />
        </div>
        <div className="mt-6 text-center text-sm text-gray-500">
          Don't have an account?{" "}
          <Button
            variant="link"
            data-test-id="signupButton"
            to={{
              pathname: "/join",
              search: searchParams.toString(),
            }}
          >
            Sign up
          </Button>
        </div>
      </div>
    </div>
  );
}
