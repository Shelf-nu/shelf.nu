import { useEffect, useMemo, useState } from "react";
import { Form, useActionData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useDisabled } from "~/hooks/use-disabled";
import type { action } from "~/routes/_layout+/account-details.general";
import Input from "../forms/input";
import { PenIcon } from "../icons/library";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

// Email change validation schema with current email check
export const createChangeEmailSchema = (currentEmail: string) =>
  z
    .object({
      type: z.literal("initiateEmailChange"),
      email: z
        .string()
        .email("Please enter a valid email")
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

export const ChangeEmailForm = ({ currentEmail }: { currentEmail: string }) => {
  const [open, setOpen] = useState(false);
  const emailZo = useZorm(
    "ChangeEmailForm",
    createChangeEmailSchema(currentEmail)
  );
  const otpZo = useZorm("OTPVerificationForm", OTPVerificationSchema);
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();

  const handleCloseDialog = () => {
    setOpen(false);
  };

  const isAwaitingOtp = useMemo(
    () => actionData && "awaitingOtp" in actionData && actionData?.awaitingOtp,
    [actionData]
  );

  const emailChanged = useMemo(
    () =>
      actionData && "emailChanged" in actionData && actionData?.emailChanged,
    [actionData]
  );

  const newEmail = useMemo(
    () => actionData && "newEmail" in actionData && actionData?.newEmail,
    [actionData]
  );

  /** When the email is finally changed, close the dialog */
  useEffect(() => {
    if (emailChanged) {
      handleCloseDialog();
    }
  }, [emailChanged]);

  /** In case the schema parsing throws errors on the server */
  const serverValidationError = useMemo(() => {
    if (!actionData) return null;

    if (
      actionData.error?.additionalData?.validationErrors &&
      typeof actionData.error.additionalData.validationErrors === "object"
    ) {
      const validationErrors = actionData.error.additionalData
        .validationErrors as { email?: { message: string } };
      return validationErrors.email?.message || null;
    }

    return null;
  }, [actionData]);

  const err =
    serverValidationError || actionData?.error?.message
      ? `${actionData?.error?.title} ${actionData?.error?.message}`
      : null;

  return (
    <div className="absolute right-1 top-3">
      <Button
        variant="block-link-gray"
        size="sm"
        onClick={() => setOpen(true)}
        type="button"
        className="text-gray-500 hover:text-gray-700"
      >
        <span>
          <PenIcon className=" size-4" />
        </span>
      </Button>
      <DialogPortal>
        <Dialog
          open={open}
          onClose={handleCloseDialog}
          title={
            <div>
              <h4 className="font-medium">
                {isAwaitingOtp ? "Verify Email Change" : "Change Email Address"}
              </h4>
              <p className="text-sm text-gray-500">
                {isAwaitingOtp && newEmail
                  ? `Enter the verification code sent to ${newEmail}`
                  : `Current email: ${currentEmail}`}
              </p>
            </div>
          }
        >
          {!isAwaitingOtp ? (
            <Form method="post" ref={emailZo.ref}>
              <div className="flex flex-col gap-2 px-6 pb-4">
                <input type="hidden" name="type" value="initiateEmailChange" />

                <div>
                  <Input
                    name={emailZo.fields.email()}
                    type="email"
                    placeholder="john@doe.com"
                    disabled={disabled}
                    className="w-full"
                    label="New email address"
                    error={emailZo.errors.email()?.message}
                  />
                </div>

                <div>
                  <Input
                    name={emailZo.fields.confirmEmail()}
                    type="email"
                    placeholder="john@doe.com"
                    disabled={disabled}
                    className="w-full"
                    label="Confirm new email"
                    error={emailZo.errors.confirmEmail()?.message}
                  />
                </div>

                {err && <div className="text-error-500">{err}</div>}

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
            <Form method="post" ref={otpZo.ref} reloadDocument>
              <div className="flex flex-col gap-2 px-6 pb-4">
                <input type="hidden" name="type" value="verifyEmailChange" />
                <input type="hidden" name="email" value={newEmail || ""} />

                <div>
                  <Input
                    name={otpZo.fields.otp()}
                    type="text"
                    placeholder="Enter 6-digit code"
                    disabled={disabled}
                    className="w-full"
                    defaultValue={""}
                    label="Verification code"
                    maxLength={6}
                    error={
                      otpZo.errors.otp()?.message || actionData?.error?.message
                    }
                  />
                </div>

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
  );
};
