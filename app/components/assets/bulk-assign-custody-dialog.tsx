import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { createCustodianSchema } from "~/modules/custody/schema";
import { type loader } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import CustodyAgreementSelector from "../custody/custody-agreement-selector";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

export const BulkAssignCustodySchema = z.object({
  assetIds: z.array(z.string()).min(1),
  custodian: createCustodianSchema(),
  agreement: z.string().optional(),
});

export default function BulkAssignCustodyDialog() {
  const zo = useZorm("BulkAssignCustody", BulkAssignCustodySchema);
  const { isSelfService } = useUserRoleHelper();
  const { teamMembers } = useLoaderData<typeof loader>();

  const [hasCustodianSelected, setHasCustodianSelected] = useState(false);

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
                isSelfService && teamMembers?.length > 0
                  ? JSON.stringify({
                      id: teamMembers[0].id,
                      name: resolveTeamMemberName(teamMembers[0]),
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
              allowClear
              closeOnSelect
              transformItem={(item) => ({
                ...item,
                id: JSON.stringify({
                  id: item.id,
                  /**
                   * This is parsed on the server, because we need the name to create the note.
                   * @TODO This should be refactored to send the name as some metadata, instaed of like this
                   */
                  name: resolveTeamMemberName(item),
                  email: item?.user?.email,
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

            <CustodyAgreementSelector
              className="mt-5"
              hasCustodianSelected={hasCustodianSelected}
            />
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
