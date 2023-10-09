import * as React from "react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useSearchParams } from "@remix-run/react";
import { GreenCheckMarkIcon } from "~/components/icons/library";
import { Button } from "~/components/shared";
import { getAuthSession } from "~/modules/auth/session.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderFunctionArgs) {
  const authSession = await getAuthSession(request);

  const title = "Check your email";
  const subHeading = " ";

  if (authSession) return redirect("/");
  return json({ title, subHeading });
}

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") || "";
  const [message, setMessage] = React.useState<string>();

  async function handleResendEmail() {
    const formData = new FormData();
    formData.append("email", email);

    try {
      const response = await fetch("/resend-email-confirmation", {
        method: "POST",
        body: formData,
      });

      if (response.status === 200) {
        setMessage("Email resent successfully. Please check your inbox.");
      } else {
        const data = await response.json();
        setMessage(data.error || "Something went wrong. Please try again.");
      }
    } catch (error) {
      setMessage("Something went wrong. Please try again.");
    }
  }

  const messageColor =
    message === "Email resent successfully. Please check your inbox."
      ? "text-green-500"
      : "text-red-500";

  return (
    <div className="flex min-h-full flex-col items-center justify-center">
      <div className="mx-auto mb-3 text-center">
        <GreenCheckMarkIcon className="h-14 w-14" />
      </div>
      <p className="mb-3 text-center">{email}</p>

      <p className="mb-6 text-center">
        We've sent you a link that you can use to complete setting up your
        account.
      </p>
      <Button
        onClick={() => (window.location.href = "mailto:")}
        className="mb-4 text-center"
        data-test-id="open-mail-app"
        width="full"
      >
        Open mail app
      </Button>
      <div className="flex flex-row items-center justify-center space-x-2 ">
        <p>Didn't receive the email?</p>

        <button
          onClick={handleResendEmail}
          className="font-bold text-orange-500"
        >
          Click to resend
        </button>
      </div>
      {message && (
        <div className={`mt-4 text-center ${messageColor}`}>{message}</div>
      )}
      <div className="mt-4 flex items-center justify-center pt-5">
        <div className="text-center text-base font-semibold text-gray-500">
          <span className="mr-2">&#8592;</span>
          <Link to="/login">Back to log in</Link>
        </div>
      </div>
    </div>
  );
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];
