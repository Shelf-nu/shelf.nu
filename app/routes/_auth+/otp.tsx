import { useEffect, useState } from "react";

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
import { supabaseClient } from "~/integrations/supabase";

import { refreshAccessToken, updateAccountPassword } from "~/modules/auth";
import { assertIsPost, isFormProcessing, tw, validEmail } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export async function loader({ context }: LoaderFunctionArgs) {
  const title = "One time password";
  const subHeading = "Enter your one time password";
  if (context.isAuthenticated) return redirect("/assets");

  return json({ title, subHeading });
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
  const formData = await request.formData();
  const result = await OtpSchema.safeParseAsync(parseFormAny(formData));

  if (!result.success) {
    return json(
      {
        message:
          "Invalid request. Please try again. If the issue persists, contact support.",
      },
      { status: 400 }
    );
  }

  const { email, otp } = result.data;

  console.log("email", email);
  console.log("otp", otp);

  // Commit the session and redirect
  // context.setSession({ ...authSession });
  // return redirect("/", {});
  return null;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export default function ResetPassword() {
  const zo = useZorm("otpForm", OtpSchema);
  const transition = useNavigation();
  const disabled = isFormProcessing(transition.state);
  const [searchParams] = useSearchParams();

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mx-auto w-full max-w-md px-8">
        <Form ref={zo.ref} method="post" className="space-y-6">
          <Input name="otp" label={"One time password"} />
          <input
            type="hidden"
            name="email"
            value={searchParams.get("email") || ""}
          />
          <Button
            data-test-id="change-password"
            type="submit"
            className="w-full "
            disabled={disabled}
          >
            Submit
          </Button>
        </Form>
      </div>
    </div>
  );
}
