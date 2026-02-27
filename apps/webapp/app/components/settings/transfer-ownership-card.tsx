import { useState } from "react";
import { Roles } from "@prisma/client";
import { Form, useActionData, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { type loader } from "~/routes/_layout+/settings.general";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { InnerLabel } from "../forms/inner-label";
import Input from "../forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import Icon from "../icons/icon";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";
import { WarningBox } from "../shared/warning-box";
import When from "../when/when";

type TransferOwnershipCardProps = {
  className?: string;
  /** Form action URL. Defaults to "/settings/general" */
  action?: string;
  /** Organization name for confirmation input. If not provided, uses currentOrganization from context */
  organizationName?: string;
};

export const TransferOwnershipSchema = z.object({
  newOwner: z.string().min(1, "New owner is required"),
  agreeConditions: z
    .string({
      required_error: "You must agree to changing the owner of the workspace",
    })
    .transform((value) => value === "on")
    .pipe(
      z.boolean().refine((value) => value, {
        message: "You must agree to changing the owner of the workspace",
      })
    ),
  transferSubscription: z
    .string()
    .optional()
    .transform((value) => value === "on"),
});

export default function TransferOwnershipCard({
  className,
  action = "/settings/general",
  organizationName,
}: TransferOwnershipCardProps) {
  const {
    admins,
    ownerSubscriptionInfo,
    ownerOtherTeamWorkspacesCount,
    premiumIsEnabled,
  } = useLoaderData<typeof loader>();
  const { isOwner } = useUserRoleHelper();
  const user = useUserData();
  const [confirmationInput, setConfirmationInput] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<
    (typeof admins)[number] | null
  >(null);
  const [transferSubscription, setTransferSubscription] = useState(false);
  const disabled = useDisabled();
  const currentOrganization = useCurrentOrganization();

  // Use provided organizationName or fall back to currentOrganization
  const confirmationOrgName = organizationName ?? currentOrganization?.name;

  const zo = useZorm("TransferOwnership", TransferOwnershipSchema);
  const actionData = useActionData<DataOrErrorResponse>();

  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<typeof TransferOwnershipSchema>(
    actionData?.error
  );

  const isShelfAdmin = user?.roles?.some((role) => role.name === Roles.ADMIN);

  // Check if current owner has a subscription that could be transferred
  const ownerHasSubscription =
    premiumIsEnabled && ownerSubscriptionInfo?.hasActiveSubscription;

  // Get general server error (non-validation errors like "user already has subscription")
  const serverError =
    actionData?.error?.message && !validationErrors
      ? actionData.error.message
      : null;

  if (!isOwner && !isShelfAdmin) {
    return null;
  }

  return (
    <Card className={tw(className)}>
      <h4 className="mb-1 text-text-lg font-semibold">
        Transfer workspace ownership
      </h4>
      <p className="mb-2 text-sm text-color-600">
        Transfer workspace to another user. To transfer the workspace, the new
        owner must be already be part of the workspace as an admin.
      </p>

      <When
        truthy={admins.length > 0}
        fallback={
          <Button
            disabled={{
              reason:
                "No admins found in this workspace. Please add an admin before transferring ownership.",
            }}
          >
            Transfer Ownership
          </Button>
        }
      >
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="secondary">Transfer Ownership</Button>
          </AlertDialogTrigger>

          <AlertDialogContent aria-describedby="Transfer ownership">
            <AlertDialogHeader>
              <AlertDialogTitle>Transfer Workspace Ownership</AlertDialogTitle>
              <AlertDialogDescription>
                Transfer workspace to another user. To transfer the workspace,
                the new owner must be already be part of the workspace as an
                admin.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <Form
              method="POST"
              encType="multipart/form-data"
              ref={zo.ref}
              action={action}
            >
              <input type="hidden" name="intent" value="transfer-ownership" />

              {/* Server error display */}
              <When truthy={!!serverError}>
                <p className="mb-4 text-sm text-error-500">{serverError}</p>
              </When>

              <InnerLabel>New owner</InnerLabel>
              <Select
                name={zo.fields.newOwner()}
                onValueChange={(value) => {
                  const newOwner = admins.find((admin) => admin.id === value);
                  setSelectedOwner(newOwner ?? null);
                  // Reset subscription transfer checkbox when changing owner
                  setTransferSubscription(false);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select new owner" />
                </SelectTrigger>

                <SelectContent>
                  {admins.map((admin) => (
                    <SelectItem key={admin.id} value={admin.id}>
                      {resolveTeamMemberName({ name: "", user: admin }, true)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <When
                truthy={
                  !!(
                    validationErrors?.newOwner?.message ||
                    zo.errors?.newOwner()?.message
                  )
                }
              >
                <p className="text-sm text-error-500">
                  {validationErrors?.newOwner?.message ||
                    zo.errors?.newOwner()?.message}
                </p>
              </When>

              <When truthy={!!selectedOwner}>
                {/* Subscription Info Section */}
                <When truthy={ownerHasSubscription}>
                  <div className="mt-4 rounded-md border border-color-200 bg-color-50 p-4">
                    <div className="flex items-center gap-2 font-medium">
                      <Icon icon="coins" />
                      <span>Subscription Information</span>
                    </div>
                    <p className="mt-2 text-sm text-color-600">
                      You have an active{" "}
                      <span className="font-semibold">
                        "{ownerSubscriptionInfo?.subscriptionName}"
                      </span>{" "}
                      subscription.
                    </p>

                    <div className="mt-3">
                      <div className="flex cursor-pointer select-none items-start gap-2 py-2 text-sm">
                        <input
                          id="transferSubscription"
                          name="transferSubscription"
                          type="checkbox"
                          checked={transferSubscription}
                          onChange={(e) =>
                            setTransferSubscription(e.target.checked)
                          }
                          aria-describedby="transferSubscription-description"
                          className="mt-0.5 rounded-sm checked:bg-primary focus-within:ring-primary checked:hover:bg-primary checked:focus:bg-primary"
                        />
                        <div>
                          <label
                            htmlFor="transferSubscription"
                            className="font-medium"
                          >
                            Transfer my subscription to the new owner
                          </label>
                          <p
                            id="transferSubscription-description"
                            className="mt-1 text-color-500"
                          >
                            The new owner will continue with the current billing
                            cycle. They will need to add their own payment
                            method before the next billing date.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Warning for multiple workspaces */}
                  <When
                    truthy={
                      transferSubscription && ownerOtherTeamWorkspacesCount > 0
                    }
                  >
                    <WarningBox className="mt-3">
                      <span className="font-semibold">
                        Multiple workspaces affected
                      </span>
                      <p className="mt-1 text-sm">
                        You own {ownerOtherTeamWorkspacesCount} other team{" "}
                        {ownerOtherTeamWorkspacesCount === 1
                          ? "workspace"
                          : "workspaces"}
                        . If you transfer your subscription, those workspaces
                        will lose premium features until you subscribe again.
                      </p>
                    </WarningBox>
                  </When>
                </When>

                <p className="mb-2 mt-4">
                  You are about to transfer ownership of this workspace to
                  <span className="ml-1 font-semibold">
                    {resolveTeamMemberName(
                      { name: "", user: selectedOwner },
                      true
                    )}
                  </span>
                  . This action cannot be undone.
                </p>
                <p>Warning - You will:</p>
                <ul className="mb-2 list-inside list-disc">
                  <li>Lose owner control of this workspace</li>
                  <li>No longer be able to manage billing</li>
                  <li>Become an admin member</li>
                  <When truthy={transferSubscription}>
                    <li>
                      Transfer your subscription to{" "}
                      {resolveTeamMemberName(
                        { name: "", user: selectedOwner },
                        true
                      )}
                    </li>
                  </When>
                </ul>

                <div className="mb-2">
                  <p>
                    To confirm this transfer, type the workspace name exactly as
                    shown:
                  </p>
                  <Input
                    label=""
                    placeholder="Enter workspace name to confirm"
                    value={confirmationInput}
                    onChange={(event) => {
                      setConfirmationInput(event.target.value);
                    }}
                  />
                  <p className="text-sm text-color-500">
                    Expected input: {confirmationOrgName}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor={zo.fields.agreeConditions()}
                    className={tw(
                      "flex cursor-pointer select-none items-center gap-2 py-2 text-sm"
                    )}
                  >
                    <input
                      id={zo.fields.agreeConditions()}
                      name={zo.fields.agreeConditions()}
                      type="checkbox"
                      className="rounded-sm checked:bg-primary focus-within:ring-primary checked:hover:bg-primary checked:focus:bg-primary"
                    />

                    <span>I understand this action cannot be undone.</span>
                  </label>
                  <When
                    truthy={
                      !!(
                        validationErrors?.agreeConditions?.message ||
                        zo.errors?.agreeConditions()?.message
                      )
                    }
                  >
                    <p className="text-sm text-error-500">
                      {validationErrors?.agreeConditions?.message ||
                        zo.errors?.agreeConditions()?.message}
                    </p>
                  </When>
                </div>
              </When>

              <AlertDialogFooter className="mt-4 flex items-center gap-2">
                <AlertDialogCancel asChild>
                  <Button
                    disabled={disabled}
                    className="flex-1"
                    variant="secondary"
                    type="button"
                  >
                    Cancel
                  </Button>
                </AlertDialogCancel>

                <Button
                  className="flex-1"
                  disabled={
                    !selectedOwner
                      ? { reason: "Please select a new owner." }
                      : confirmationInput !== confirmationOrgName
                      ? {
                          reason: "Please type the workspace name to confirm.",
                        }
                      : disabled
                  }
                >
                  Transfer ownership
                </Button>
              </AlertDialogFooter>
            </Form>
          </AlertDialogContent>
        </AlertDialog>
      </When>
    </Card>
  );
}
