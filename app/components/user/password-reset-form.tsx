import { useEffect, useRef, useState } from "react";

import { Form } from "@remix-run/react";
import { useFetcher } from "react-router-dom";
import { useDelayedLogout } from "~/hooks";
import { isFormProcessing } from "~/utils";
import Input from "../forms/input";
import { Button } from "../shared/button";

interface Props {
  userEmail: string | undefined;
}

export default function PasswordResetForm({ userEmail }: Props) {
  const [isSending, setIsSending] = useState<boolean>(false);
  const fetcher = useFetcher();
  const isProcessing = isFormProcessing(fetcher.state);
  const logoutFormRef = useRef(null);

  /** Hook that handles the delayed logout */
  useDelayedLogout({
    trigger: fetcher?.data?.passwordReset,
    logoutFormRef,
  });

  useEffect(() => {
    /** If fetcher is processing, set the value to true
     * We use this because we are submitting 2 forms in a row and that way i ensure the correct state is used for displaying the link text
     *
     */
    if (isProcessing) {
      setIsSending(true);
    }
    /** IF ther is an error, set it back to default state */
    if (fetcher?.data?.message) {
      setIsSending(false);
    }
  }, [isProcessing, fetcher]);

  return (
    <div>
      <fetcher.Form method="post" replace className="border-t py-8">
        <div>
          <p>
            Use the link to send yourself a password reset email. You will be
            logged out 3 seconds after clicking the link.
          </p>
          <Button
            type="submit"
            disabled={isProcessing}
            name="intent"
            value="resetPassword"
            variant="link"
          >
            {isProcessing || isSending
              ? "Sending link and logging you out..."
              : "Send password reset email."}
          </Button>
          <Input
            label="email"
            hideLabel={true}
            data-test-id="email"
            name="email"
            type="hidden"
            disabled={isProcessing || isSending}
            value={userEmail}
            error={fetcher?.data?.error}
          />
        </div>
        <div className="mt-4 text-right"></div>
      </fetcher.Form>
      <div className="hidden">
        <Form action="/logout" method="post" ref={logoutFormRef}>
          <button data-test-id="logout" type="submit" />
        </Form>
      </div>
    </div>
  );
}
