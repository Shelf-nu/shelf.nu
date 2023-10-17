import React from "react";
import { useFetcher } from "@remix-run/react";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";

import type { action } from "~/routes/_auth+/send-magic-link";

export function ContinueWithEmailForm() {
  const ref = React.useRef<HTMLFormElement>(null);

  const sendMagicLink = useFetcher<typeof action>();
  const { data, state } = sendMagicLink;
  const isSuccessFull = state === "idle" && data != null && !data?.error;
  const isLoading = state === "submitting" || state === "loading";
  const buttonLabel = isLoading
    ? "Sending you a link..."
    : "Continue with Magic Link";

  React.useEffect(() => {
    if (isSuccessFull) {
      ref.current?.reset();
    }
  }, [isSuccessFull]);

  return (
    <sendMagicLink.Form method="post" action="/send-magic-link" ref={ref}>
      <Input
        label="Magic link"
        hideLabel={true}
        type="email"
        name="email"
        id="magic-link"
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

      {isSuccessFull && (
        <div
          className={`mb-2 h-6 text-center text-green-600`}
          data-test-id="magicLinkSuccessMessage"
        >
          Check your emails
        </div>
      )}
    </sendMagicLink.Form>
  );
}
