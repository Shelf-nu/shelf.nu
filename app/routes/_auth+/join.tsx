import * as React from "react";

import type { LoaderArgs, V2_MetaFunction } from "@remix-run/node";
import { redirect, json } from "@remix-run/node";
import { useSearchParams } from "@remix-run/react";
import { Button } from "~/components/shared/button";

import { getAuthSession, ContinueWithEmailForm } from "~/modules/auth";
import { getCurrentSearchParams } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ request }: LoaderArgs) {
  const authSession = await getAuthSession(request);
  const searchParams = getCurrentSearchParams(request);
  const isResend = searchParams.get("resend") !== null;

  const title = isResend ? "Resend confirmation email" : "Create an account";
  const subHeading = isResend
    ? "If you had issues with confirming your email, you can resend the confirmation email using the form below"
    : "Start your journey with Shelf";

  if (authSession) return redirect("/");

  return json({ title, subHeading, isResend });
}

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function Join() {
  const [searchParams] = useSearchParams();
  const isResend = searchParams.get("resend") !== null;

  return (
    <div className="w-full max-w-md">
      <div className="">
        <ContinueWithEmailForm />
      </div>
      <div className="mt-6 flex items-center justify-center">
        <div className="text-center text-sm text-gray-500">
          {isResend
            ? "Already confirmed your account?"
            : "Already have an account?"}{" "}
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
  );
}
