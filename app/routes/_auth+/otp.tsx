import { useState } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import {
  useActionData,
  useNavigation,
  useSearchParams,
} from "@remix-run/react";
import { Form } from "~/components/custom-form";
import { useZorm } from "react-zorm";
import { z } from "zod";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { verifyOtpAndSignin } from "~/modules/auth/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { getOrganizationByUserId } from "~/modules/organization/service.server";
import { createUser, findUserByEmail } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { isErrorResponse } from "~/utils/http";
import {
  data,
  error,
  getActionMethod,
  parseData,
  safeRedirect,
} from "~/utils/http.server";
import { validEmail } from "~/utils/misc";
import { getOtpPageData, type OtpVerifyMode } from "~/utils/otp";
import { tw } from "~/utils/tw";
import { randomUsernameFromEmail } from "~/utils/user";

export function loader({ context, request }: LoaderFunctionArgs) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") as OtpVerifyMode;
  const title = getOtpPageData(mode).title;

  if (context.isAuthenticated) {
    return redirect("/assets");
  }

  return json(data({ title }));
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
  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { email, otp } = parseData(await request.formData(), OtpSchema, {
          message:
            "Invalid request. Please try again. If the issue persists, contact support.",
        });

        const authSession = await verifyOtpAndSignin(email, otp);
        const userExists = Boolean(await findUserByEmail(email));

        if (!userExists) {
          await createUser({
            ...authSession,
            username: randomUsernameFromEmail(authSession.email),
          });
        }

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

export default function OtpPage() {
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
    formData.append("mode", mode);

    try {
      const response = await fetch("/send-otp", {
        method: "post",
        body: formData,
      });

      if (response.status === 200) {
        setMessage({
          message: "Email sent successfully. Please check your inbox.",
          type: "success",
        });
      } else {
        const data = await response.json();
        setMessage({
          message: isErrorResponse(data)
            ? data.error.message
            : "Something went wrong. Please try again!",
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
            <Input name="otp" label="Code" required placeholder="133734" />
            <input
              type="hidden"
              name="email"
              value={searchParams.get("email") || ""}
            />

            {data?.error.message ? (
              <div className="!mt-1  text-sm text-error-500">
                {data.error.message}
              </div>
            ) : null}
            {message?.message && (
              <p
                className={tw(
                  " text-sm",
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
