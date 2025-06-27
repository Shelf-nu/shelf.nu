import { useState } from "react";
import type { Prisma } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { createCustodianSchema } from "~/modules/custody/schema";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import CustodyAgreementSelector from "../custody/custody-agreement-selector";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

export const BulkAssignKitCustodySchema = z.object({
  kitIds: z.array(z.string()).min(1),
  custodian: createCustodianSchema(),
  agreement: z.string().optional(),
});

export default function BulkAssignCustodyDialog() {
  const zo = useZorm("BulkAssignKitCustody", BulkAssignKitCustodySchema);

  const { isSelfService } = useUserRoleHelper();
  const { teamMembers } = useLoaderData<{
    teamMembers: Prisma.TeamMemberGetPayload<{ include: { user: true } }>[];
  }>();

  const user = useUserData();
  const currentTeamMember = teamMembers.find((tm) => tm.userId === user?.id);

  const [hasCustodianSelected, setHasCustodianSelected] =
    useState(isSelfService); // If self-service, we assume the custodian is already selected

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="assign-custody"
      title={`${isSelfService ? "Take" : "Assign"} custody of kit`}
      description={`These kits are currently available. You're about to assign custody to ${
        isSelfService ? "yourself" : "one of your team members"
      }.`}
      arrayFieldId="kitIds"
      actionUrl="/api/kits/bulk-actions"
    >
      {({ disabled, fetcherError, handleCloseDialog }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-8">
            <input type="hidden" value="bulk-assign-custody" name="intent" />

            <DynamicSelect
              hidden={isSelfService}
              defaultValue={
                isSelfService && currentTeamMember
                  ? JSON.stringify({
                      id: currentTeamMember.id,
                      name: resolveTeamMemberName(currentTeamMember),
                      email: currentTeamMember.user?.email,
                    })
                  : undefined
              }
              disabled={disabled || isSelfService}
              model={{
                name: "teamMember",
                queryKey: "name",
                deletedAt: null,
              }}
              fieldName="custodian"
              contentLabel="Team members"
              initialDataKey="teamMembers"
              countKey="totalTeamMembers"
              placeholder="Select a team member"
              closeOnSelect
              transformItem={(item) => ({
                ...item,
                id: JSON.stringify({
                  id: item.id,
                  name: resolveTeamMemberName(item),
                  email: item.user?.email,
                }),
              })}
              renderItem={(item) => resolveTeamMemberName(item, true)}
              onChange={(value) => {
                setHasCustodianSelected(!!value);
              }}
            />
            {zo.errors.custodian()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors.custodian()?.message}
              </p>
            ) : null}
            {fetcherError ? (
              <p className="text-sm text-error-500">{fetcherError}</p>
            ) : null}
          </div>

          <CustodyAgreementSelector
            className={tw("mb-12", isSelfService ? "-mt-10" : "mt-4")}
            hasCustodianSelected={hasCustodianSelected}
          />

          <div className={tw("flex gap-3", isSelfService && "-mt-8")}>
            <Button
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button variant="primary" width="full" disabled={disabled}>
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
