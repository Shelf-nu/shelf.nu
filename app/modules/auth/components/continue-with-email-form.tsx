import { useFetcher } from "@remix-run/react";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

import type { action } from "~/routes/_auth+/send-magic-link";

export function ContinueWithEmailForm({ mode }: { mode: "login" | "signup" }) {
  const sendMagicLink = useFetcher<typeof action>();
  const { data, state } = sendMagicLink;

  const isLoading = state === "submitting" || state === "loading";
  const buttonLabel = isLoading
    ? "Sending you a one time password..."
    : "Continue with OTP";

  return (
    <sendMagicLink.Form method="post" action="/send-magic-link">
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
      >
        {buttonLabel}
      </Button>
    </sendMagicLink.Form>
  );
}
