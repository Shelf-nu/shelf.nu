import { useState } from "react";
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
import { Button } from "~/components/shared/button";
import { verifyOtpAndSignin } from "~/modules/auth/service.server";
import { getOrganizationByUserId } from "~/modules/organization";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getUserByEmail, tryCreateUser } from "~/modules/user";
import {
  assertIsPost,
  isFormProcessing,
  randomUsernameFromEmail,
  safeRedirect,
  tw,
  validEmail,
} from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { getOtpPageData, type OtpVerifyMode } from "~/utils/otp";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") as OtpVerifyMode;

  const title = getOtpPageData(mode).title;
  if (context.isAuthenticated) return redirect("/assets");

  return json({ title });
}

const OtpSchema = z.object({
  otp: z.string().min(2),
  email: z
    .string()
    .transform((email) => email.toLowerCase())
    .refine(validEmail, () => ({
      message: "Please enter a valid email",
    })),
});

export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const formData = await request.formData();
  const result = await OtpSchema.safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        error:
          "Invalid request. Please try again. If the issue persists, contact support.",
      },
      { status: 400 }
    );
  }

  const { email, otp } = result.data;

  const otpVerifyResult = await verifyOtpAndSignin(email, otp);
  if (otpVerifyResult.status === "error") {
    return json({ error: otpVerifyResult.message }, { status: 400 });
  }

  if (otpVerifyResult.status === "success" && otpVerifyResult.authSession) {
    const { authSession } = otpVerifyResult;

    // Case 1. If the user exists, then skip creation and just commit the session
    if (await getUserByEmail(authSession.email)) {
      const personalOrganization = await getOrganizationByUserId({
        userId: authSession.userId,
        orgType: "PERSONAL",
      });

      // Setting the auth session and redirecting user to assets page
      context.setSession(authSession);

      return redirect(safeRedirect("/assets"), {
        headers: [
          setCookie(
            await setSelectedOrganizationIdCookie(personalOrganization.id)
          ),
        ],
      });
    }
    // Case 2. First time sign in, let's create a brand-new User in supabase
    else {
      const username = randomUsernameFromEmail(authSession.email);

      const user = await tryCreateUser({ ...authSession, username });
      if (!user) {
        return json(
          {
            error:
              "We had trouble while creating your account. Please try again.",
          },
          { status: 500 }
        );
      }

      const personalOrganization = user.organizations[0];
      // setting the session
      context.setSession(authSession);

      return redirect(safeRedirect("/assets"), {
        headers: [
          setCookie(
            await setSelectedOrganizationIdCookie(personalOrganization.id)
          ),
        ],
      });
    }
  }

  // handling unexpected scenarios
  return json(
    { error: "Something went wrong. Please try again later." },
    { status: 500 }
  );
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function ResetPassword() {
  const [message, setMessage] = useState<{
    message: string;
    type: "success" | "error";
  }>();
  const data = useActionData<typeof action>();
  const [searchParams] = useSearchParams();

  const zo = useZorm("otpForm", OtpSchema);
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);

  const email = searchParams.get("email") || "";
  const mode = searchParams.get("mode") as OtpVerifyMode;
  const pageData = getOtpPageData(mode);

  async function handleResendOtp() {
    const formData = new FormData();
    formData.append("email", email);

    try {
      const response = await fetch("/resend-email-confirmation", {
        method: "post",
        body: formData,
      });

      if (response.status === 200) {
        setMessage({
          message: "Email send successfully. Please check your inbox.",
          type: "success",
        });
      } else {
        const data = await response.json();
        setMessage({
          message: data.error ?? "Something went wrong. Please try again!",
          type: "error",
        });
      }
    } catch {
      setMessage({
        message: "Something went wrong. Please try again.",
        type: "error",
      });
    }
  }

  return (
    <>
      <pageData.SubHeading email={email} />

      <div className="mt-2 flex min-h-full flex-col justify-center">
        <div className="mx-auto w-full max-w-md px-8">
          <Form ref={zo.ref} method="post" className="space-y-6">
            <Input name="otp" label="Code" required />
            <input
              type="hidden"
              name="email"
              value={searchParams.get("email") || ""}
            />

            {data?.error && (
              <p className="text-center text-sm text-error-500">
                {data?.error}
              </p>
            )}
            {message?.message && (
              <p
                className={tw(
                  "text-center text-sm",
                  message.type === "error"
                    ? "text-error-500"
                    : "text-success-500"
                )}
              >
                {message.message}
              </p>
            )}

            <Button
              data-test-id="create-account"
              type="submit"
              className="w-full "
              disabled={disabled}
            >
              {pageData.buttonTitle}
            </Button>
          </Form>

          <button
            className="mt-6 w-full text-center text-sm font-semibold"
            onClick={handleResendOtp}
          >
            Did not receive a code?{" "}
            <span className="text-primary-500">Send again</span>
          </button>
        </div>
      </div>
    </>
  );
}
