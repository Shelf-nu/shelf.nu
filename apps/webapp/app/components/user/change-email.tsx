import { useCallback, useEffect, useRef, useState } from "react";
import { Form, useActionData, useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserData } from "~/hooks/use-user-data";
import type { action } from "~/routes/_layout+/account-details.general";
import Input from "../forms/input";
import { PenIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

// Email change validation schema with current email check
export const createChangeEmailSchema = (
  currentEmail: string,
  ssoDomains?: string[]
) =>
  z
    .object({
      type: z.literal("initiateEmailChange"),
      email: z
        .string()
        .email("Please enter a valid email")
        .refine(
          (email) =>
            // Show error if domain is in ssoDomains list
            !ssoDomains?.length || !ssoDomains.includes(email.split("@")[1]),
          {
            message:
              "The email's domain is not allowed for security reasons. For more information, please get in touch with support.",
          }
        )
        .refine((email) => email.toLowerCase() !== currentEmail.toLowerCase(), {
          message: "New email must be different from your current email",
        }),
      confirmEmail: z.string(),
    })
    .superRefine(({ email: newEmail, confirmEmail }, ctx) => {
      if (newEmail !== confirmEmail) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Emails do not match",
          path: ["confirmEmail"],
        });
      }
    });

// OTP verification schema
const OTPVerificationSchema = z.object({
  type: z.literal("verifyEmailChange"),
  otp: z
    .string()
    .min(6, "Code must be 6 digits")
    .max(6, "Code must be 6 digits"),
});

interface FormState {
  isAwaitingOtp: boolean;
  newEmail: string | null;
}

export const ChangeEmailForm = ({ currentEmail }: { currentEmail: string }) => {
  const [open, setOpen] = useState(false);
  const [formState, setFormState] = useState<FormState>({
    isAwaitingOtp: false,
    newEmail: null,
  });

  const emailZo = useZorm(
    "ChangeEmailForm",
    createChangeEmailSchema(currentEmail)
  );
  const otpZo = useZorm("OTPVerificationForm", OTPVerificationSchema);
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();
  const user = useUserData();

  // Handle closing dialog and resetting state
  const handleCloseDialog = useCallback(() => {
    setOpen(false);
    setFormState({ isAwaitingOtp: false, newEmail: null });
  }, []);

  /**
   * Reconcile local form state with the latest action response.
   *
   * React Router delivers `actionData` asynchronously after a submit, so this
   * reconciliation is inherently derived-from-props rather than an event
   * handler. Tracking the processed response by identity prevents re-applying
   * the same transition if the component re-renders for unrelated reasons,
   * which is what `no-effect-event-handler` is guarding against.
   */
  const lastProcessedActionRef = useRef<typeof actionData | null>(null);
  if (actionData && lastProcessedActionRef.current !== actionData) {
    lastProcessedActionRef.current = actionData;

    if ("awaitingOtp" in actionData && actionData.awaitingOtp) {
      // Defer the state update to avoid setState-during-render warnings.
      queueMicrotask(() => {
        setFormState({
          isAwaitingOtp: true,
          newEmail:
            "newEmail" in actionData ? (actionData.newEmail as string) : null,
        });
      });
    } else if ("emailChanged" in actionData && actionData.emailChanged) {
      queueMicrotask(handleCloseDialog);
    }
  }

  // Handle server-side validation errors
  const serverError = actionData?.error?.message
    ? `${actionData.error.title || ""} ${actionData.error.message}`
    : null;

  const isOtpInvalidError =
    actionData?.error?.message === "Invalid or expired verification code";

  useEffect(() => {
    if (isOtpInvalidError && otpZo.form) {
      otpZo.form.reset();
    }
  }, [isOtpInvalidError, otpZo.form]);

  // Auto-focus dialog fields without using `autoFocus` (which trips
  // jsx-a11y/no-autofocus). The hook covers Radix portal mount timing.
  const emailInputRef = useAutoFocus<HTMLInputElement>({
    when: open && !formState.isAwaitingOtp,
  });
  const otpInputRef = useAutoFocus<HTMLInputElement>({
    when: open && formState.isAwaitingOtp,
  });

  return !user?.sso ? (
    <div className="absolute right-1 top-3">
      <Button
        variant="block-link-gray"
        size="sm"
        onClick={() => setOpen(true)}
        type="button"
        className="text-gray-500 hover:text-gray-700"
      >
        <PenIcon className="size-4" />
      </Button>
      <DialogPortal>
        <Dialog
          open={open}
          onClose={handleCloseDialog}
          title={
            <div>
              <h4 className="font-medium">
                {formState.isAwaitingOtp
                  ? "Verify Email Change"
                  : "Change Email Address"}
              </h4>
              <p className="text-sm text-gray-500">
                {formState.isAwaitingOtp
                  ? `Enter the verification code sent to ${formState.newEmail}`
                  : `Current email: ${currentEmail}`}
              </p>
            </div>
          }
        >
          {!formState.isAwaitingOtp ? (
            <Form method="post" ref={emailZo.ref} key="email-form">
              <div className="flex flex-col gap-2 px-6 pb-4">
                <input type="hidden" name="type" value="initiateEmailChange" />

                <Input
                  ref={emailInputRef}
                  name={emailZo.fields.email()}
                  type="email"
                  autoComplete="email"
                  placeholder="zaans@huisje.com"
                  disabled={disabled}
                  className="w-full"
                  label="New email address"
                  error={emailZo.errors.email()?.message}
                />

                <Input
                  name={emailZo.fields.confirmEmail()}
                  type="email"
                  autoComplete="email"
                  placeholder="zaans@huisje.com"
                  disabled={disabled}
                  className="w-full"
                  label="Confirm new email"
                  error={emailZo.errors.confirmEmail()?.message}
                />

                {/* Validation errors */}
                {actionData?.error?.additionalData?.validationErrors &&
                typeof actionData?.error?.additionalData?.validationErrors ===
                  "object" ? (
                  Object.values(
                    actionData?.error?.additionalData?.validationErrors
                  ).map((error) => (
                    <div key={error.message} className="text-error-500">
                      {error.message}
                    </div>
                  ))
                ) : serverError ? ( // Other server errors
                  <div className="text-error-500">{serverError}</div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    onClick={handleCloseDialog}
                    disabled={disabled}
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={disabled}
                    name="intent"
                    value="initiateEmailChange"
                  >
                    {disabled ? "Updating..." : "Update email"}
                  </Button>
                </div>
              </div>
            </Form>
          ) : (
            <Form method="post" ref={otpZo.ref} key={"otp-form"}>
              <div className="flex flex-col gap-2 px-6 pb-4">
                <input type="hidden" name="type" value="verifyEmailChange" />
                <input
                  type="hidden"
                  name="email"
                  value={formState.newEmail || ""}
                />

                <Input
                  ref={otpInputRef}
                  name={otpZo.fields.otp()}
                  type="text"
                  placeholder="Enter 6-digit code"
                  disabled={disabled}
                  className="w-full"
                  label="Verification code"
                  maxLength={6}
                  defaultValue=""
                  error={
                    otpZo.errors.otp()?.message || actionData?.error?.message
                  }
                />

                <div className="flex justify-end gap-2">
                  <ResendCodeForm disabled={disabled} formState={formState} />
                  <Button
                    type="button"
                    onClick={handleCloseDialog}
                    disabled={disabled}
                    variant="secondary"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={disabled}
                    name="intent"
                    value="verifyEmailChange"
                  >
                    {disabled ? "Verifying..." : "Verify"}
                  </Button>
                </div>
              </div>
            </Form>
          )}
        </Dialog>
      </DialogPortal>
    </div>
  ) : null;
};

function ResendCodeForm({
  disabled,
  formState,
}: {
  disabled: boolean;
  formState: FormState;
}) {
  /** We need to use fetcher because this is placed within the other form. This just makes it easier to send the data */
  const fetcher = useFetcher<typeof action>({ key: "resendOtp" });
  const localDisabled = useDisabled(fetcher);
  return formState.newEmail ? (
    <div className="flex items-center justify-center gap-2">
      {/* @ts-expect-error */}
      {fetcher?.data?.success ? (
        <div className="text-success-500">Code has been resent.</div>
      ) : null}
      <Button
        variant="block-link-gray"
        type="button"
        width="auto"
        className="mt-0"
        disabled={disabled || localDisabled}
        onClick={() => {
          const formData = new FormData();
          formData.append("type", "initiateEmailChange");
          formData.append("intent", "initiateEmailChange");
          formData.append("email", formState.newEmail || "");
          formData.append("confirmEmail", formState.newEmail || "");
          void fetcher.submit(formData, {
            method: "POST",
          });
        }}
      >
        {localDisabled ? "Sending code..." : "Resend code"}
      </Button>
    </div>
  ) : null;
}
