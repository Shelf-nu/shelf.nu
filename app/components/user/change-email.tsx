import { useState } from "react";
import { Form, useActionData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useDisabled } from "~/hooks/use-disabled";
import type { action } from "~/routes/_layout+/account-details.general";
import Input from "../forms/input";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

// Email change validation schema with current email check
export const createChangeEmailSchema = (currentEmail: string) =>
  z
    .object({
      // this is the new email
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

type ChangeEmailFormProps = {
  /** Current user email */
  currentEmail: string;
  /** Whether there's a pending email change */
  isPending?: boolean;
  /** The pending new email if any */
  pendingEmail?: string;
};

export const ChangeEmailForm = ({
  currentEmail,
  isPending = false,
  pendingEmail,
}: ChangeEmailFormProps) => {
  const [open, setOpen] = useState(false);
  const zo = useZorm("ChangeEmailForm", createChangeEmailSchema(currentEmail));
  const disabled = useDisabled();
  const actionData = useActionData<typeof action>();
  // @TODO pending change state
  // if (isPending && pendingEmail) {
  //   return (
  //     <div className="flex items-center gap-2 text-sm text-gray-600">
  //       <Clock className="h-4 w-4" />
  //       <span>Email change to {pendingEmail} pending confirmation</span>
  //     </div>
  //   );
  // }
  const handleCloseDialog = () => {
    setOpen(false);
  };

  return (
    <div>
      <Button
        variant="block-link-gray"
        size="sm"
        onClick={() => setOpen(true)}
        type="button"
      >
        Change email
      </Button>
      <DialogPortal>
        <Dialog
          open={open}
          onClose={handleCloseDialog}
          title={
            <div className="">
              <h4 className="font-medium">Change Email Address</h4>
              <p className="text-sm text-gray-500">
                Current email: {currentEmail}
              </p>
            </div>
          }
        >
          <Form method="post" ref={zo.ref}>
            <div className="flex flex-col gap-2 px-6 pb-4">
              <div className="">
                <Input
                  name={zo.fields.email()}
                  type="email"
                  placeholder="john@doe.com"
                  disabled={disabled}
                  className="w-full"
                  label={"New email address"}
                  error={zo.errors.email()?.message}
                />
              </div>

              <div className="">
                <Input
                  name={zo.fields.confirmEmail()}
                  type="email"
                  placeholder="john@doe.com"
                  disabled={disabled}
                  className="w-full"
                  label={"Confirm new email"}
                  error={zo.errors.confirmEmail()?.message}
                />
              </div>
              {!actionData?.error && actionData?.success ? (
                <div className="text-success-500">
                  A confirmation link has been sent to your new email.
                </div>
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
                  value="changeEmail"
                >
                  {" "}
                  {disabled ? "Updating..." : "Update email"}
                </Button>
              </div>
            </div>
          </Form>
        </Dialog>
      </DialogPortal>
    </div>
  );
};
