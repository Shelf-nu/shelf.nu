import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { type loader } from "~/routes/_layout+/settings.general";
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
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";
import When from "../when/when";

type TransferOwnershipCardProps = {
  className?: string;
};

export const TransferOwnershipSchema = z.object({
  newOwner: z.string().min(1, "New owner is required"),
});

export default function TransferOwnershipCard({
  className,
}: TransferOwnershipCardProps) {
  const { admins } = useLoaderData<typeof loader>();
  const { isOwner } = useUserRoleHelper();
  const [confirmationInput, setConfirmationInput] = useState("");
  const [selectedOwner, setSelectedOwner] = useState<
    (typeof admins)[number] | null
  >(null);
  const disabled = useDisabled();

  const currentOrganization = useCurrentOrganization();

  const zo = useZorm("TransferOwnership", TransferOwnershipSchema);

  const formError = zo.errors?.newOwner()?.message;

  if (!isOwner) {
    return null;
  }

  return (
    <Card className={tw(className)}>
      <h4 className="mb-1 text-text-lg font-semibold">
        Transfer workspace ownership
      </h4>
      <p className="mb-2 text-sm text-gray-600">
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

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Transfer Workspace Ownership</AlertDialogTitle>
            </AlertDialogHeader>

            <form method="POST" encType="multipart/form-data" ref={zo.ref}>
              <input type="hidden" name="intent" value="transfer-ownership" />

              <InnerLabel>New owner</InnerLabel>
              <Select
                name={zo.fields.newOwner()}
                onValueChange={(value) => {
                  const newOwner = admins.find((admin) => admin.id === value);
                  setSelectedOwner(newOwner ?? null);
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

              <When truthy={!!formError}>
                <p className="text-sm text-error-500">{formError}</p>
              </When>

              <When truthy={!!selectedOwner}>
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
                </ul>

                <div>
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
                  <p className="text-sm text-gray-500">
                    Expected input: {currentOrganization?.name}
                  </p>
                </div>
              </When>

              <AlertDialogFooter className="mt-4 flex items-center gap-2">
                <AlertDialogCancel asChild>
                  <Button className="flex-1" variant="secondary" type="button">
                    Cancel
                  </Button>
                </AlertDialogCancel>

                <Button
                  className="flex-1"
                  disabled={
                    !selectedOwner
                      ? { reason: "Please select a new owner." }
                      : confirmationInput !== currentOrganization?.name
                      ? { reason: "Please type the workspace name to confirm." }
                      : disabled
                      ? { reason: "Form is processing..." }
                      : false
                  }
                >
                  Transfer ownership
                </Button>
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </When>
    </Card>
  );
}
