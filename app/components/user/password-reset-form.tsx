import { useRef } from "react";
import { useFetcher } from "react-router-dom";
import { isFormProcessing } from "~/utils/form";
import { Form } from "../custom-form";
import Input from "../forms/input";
import { Button } from "../shared/button";

interface Props {
  userEmail: string | undefined;
}

export default function PasswordResetForm({ userEmail }: Props) {
  const fetcher = useFetcher();
  const isProcessing = isFormProcessing(fetcher.state);
  const logoutFormRef = useRef(null);

  return (
    <div>
      <fetcher.Form method="post" className="border-t py-8">
        <div>
          <p>
            Use the link to send yourself a password reset email. You will be
            logged out 3 seconds after clicking the link.
          </p>
          <input type="hidden" name="type" value="resetPassword" />

          <Button
            type="submit"
            disabled={isProcessing}
            name="intent"
            value="resetPassword"
            variant="link"
          >
            {isProcessing
              ? "Sending link and logging you out..."
              : "Send password reset email."}
          </Button>
          <Input
            label="email"
            hideLabel={true}
            data-test-id="email"
            name="email"
            type="hidden"
            disabled={isProcessing}
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
