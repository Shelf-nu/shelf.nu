import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { createCustodianSchema } from "~/modules/custody/schema";
import type { KitIndexLoaderData } from "~/routes/_layout+/kits._index";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

export const BulkAssignKitCustodySchema = z.object({
  kitIds: z.array(z.string()).min(1),
  custodian: createCustodianSchema(),
});

export default function BulkAssignCustodyDialog() {
  const zo = useZorm("BulkAssignKitCustody", BulkAssignKitCustodySchema);

  const { isSelfService } = useUserRoleHelper();
  const { currentUserTeamMember } = useLoaderData<KitIndexLoaderData>();

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

            {isSelfService && currentUserTeamMember ? (
              <input
                type="hidden"
                name="custodian"
                value={JSON.stringify({
                  id: currentUserTeamMember.id,
                  name: resolveTeamMemberName(currentUserTeamMember),
                })}
              />
            ) : (
              <DynamicSelect
                disabled={disabled}
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
                  }),
                })}
                renderItem={(item) => resolveTeamMemberName(item, true)}
              />
            )}
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
