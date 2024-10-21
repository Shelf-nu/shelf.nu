import { useLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { type loader } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { stringToJSONSchema } from "~/utils/zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

export const BulkAssignCustodySchema = z.object({
  assetIds: z.array(z.string()).min(1),
  custodian: stringToJSONSchema.pipe(
    z.object({ id: z.string(), name: z.string() })
  ),
});

export default function BulkAssignCustodyDialog() {
  const zo = useZorm("BulkAssignCustody", BulkAssignCustodySchema);

  const { isSelfService } = useUserRoleHelper();
  const { rawTeamMembers } = useLoaderData<typeof loader>();

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="assign-custody"
      title={`${isSelfService ? "Take" : "Assign"} custody of assets`}
      description={`These assets are currently available. You're about to assign custody to ${
        isSelfService ? "yourself" : "one of your team members"
      }.`}
      actionUrl="/api/assets/bulk-assign-custody"
      arrayFieldId="assetIds"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-8">
            <DynamicSelect
              hidden={isSelfService}
              defaultValue={
                isSelfService && rawTeamMembers?.length > 0
                  ? JSON.stringify({
                      id: rawTeamMembers[0].id,
                      name: resolveTeamMemberName(rawTeamMembers[0]),
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
              initialDataKey="rawTeamMembers"
              countKey="totalTeamMembers"
              placeholder="Select a team member"
              allowClear
              closeOnSelect
              transformItem={(item) => ({
                ...item,
                id: JSON.stringify({
                  id: item.id,
                  //If there is a user, we use its name, otherwise we use the name of the team member
                  name: resolveTeamMemberName(item),
                }),
              })}
              renderItem={(item) => resolveTeamMemberName(item, true)}
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
