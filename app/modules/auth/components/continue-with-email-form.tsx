import { useFetcher } from "@remix-run/react";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

import type { action } from "~/routes/_auth+/send-otp";

export function ContinueWithEmailForm({ mode }: { mode: "login" | "signup" }) {
  const sendOTP = useFetcher<typeof action>();
  const { data, state } = sendOTP;

  const isLoading = state === "submitting" || state === "loading";
  const buttonLabel = isLoading
    ? "Sending you a one time password..."
    : "Continue with OTP";

  return (
    <sendOTP.Form method="post" action="/send-otp">
      <input type="hidden" name="mode" value={mode} />
      <Input
        label="Email"
        hideLabel={true}
        type="email"
        name="email"
        id="email"
        inputClassName="w-full"
        placeholder="zaans@huisje.com"
        disabled={isLoading}
        error={data?.error || ""}
      />

      <Button
        type="submit"
        disabled={isLoading}
        width="full"
        variant="secondary"
        className="mt-3"
        data-test-id="continueWithMagicLink"
        title="One Time Password (OTP) is the most secure way to login. We will send you a code to your email."
      >
        {buttonLabel}
      </Button>
    </sendOTP.Form>
  );
}
