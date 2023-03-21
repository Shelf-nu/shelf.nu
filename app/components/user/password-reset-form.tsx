import { useEffect, useRef } from "react";

import { Form, useSubmit } from "@remix-run/react";
import { useFetcher } from "react-router-dom";
import { isFormProcessing } from "~/utils";
import Input from "../forms/input";
import { Button } from "../shared/button";

interface Props {
  userEmail: string | undefined;
}

export default function PasswordResetForm({ userEmail }: Props) {
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);
  const logoutFormRef = useRef(null);
  const submit = useSubmit();

  useEffect(() => {
    if (fetcher?.data?.passwordReset) {
      const timer = setTimeout(() => {
        submit(logoutFormRef.current, { replace: true });
      }, 3000);

      return () => {
        if (timer) {
          clearTimeout(timer);
        }
      };
    }
  }, [fetcher?.data?.passwordReset, submit]);

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
            disabled={disabled}
            name="intent"
            value="resetPassword"
            variant="link"
          >
            Send password reset email.
          </Button>
          <Input
            label="email"
            hideLabel={true}
            data-test-id="email"
            name="email"
            type="hidden"
            disabled={disabled}
            value={userEmail}
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
