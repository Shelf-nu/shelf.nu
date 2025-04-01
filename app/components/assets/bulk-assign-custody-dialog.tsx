import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsCountAtom } from "~/atoms/list";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { createCustodianSchema } from "~/modules/custody/schema";
import { type loader } from "~/routes/_layout+/assets._index";
import type { BulkAssignCustodySuccessMessageType } from "~/routes/api+/assets.bulk-assign-custody";
import { BULK_CUSTODY_SUCCESS_CONTENT } from "~/utils/bulk-custody";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import CustodyAgreementSelector from "../custody/custody-agreement-selector";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";
import When from "../when/when";

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
  const [isSuccess, setIsSuccess] = useState(false);

  const totalAssets = useAtomValue(selectedBulkItemsCountAtom);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="assign-custody"
      className="lg:w-[500px]"
      title={`${isSelfService ? "Take" : "Assign"} custody of assets`}
      description={`These assets are currently available. You're about to assign custody to ${
        isSelfService ? "yourself" : "one of your team members"
      }.`}
      actionUrl="/api/assets/bulk-assign-custody"
      arrayFieldId="assetIds"
      skipCloseOnSuccess
      hideHeader={isSuccess}
      onSuccess={() => {
        setIsSuccess(true);
      }}
    >
      {({ disabled, handleCloseDialog, fetcherError, fetcherData }) => (
        <div className="modal-content-wrapper">
          <When truthy={!isSuccess}>
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
          </When>

          <When truthy={isSuccess}>
            <div>
              {fetcherData?.successMessageType ? (
                <div className="mb-4">
                  {BULK_CUSTODY_SUCCESS_CONTENT[
                    fetcherData.successMessageType as BulkAssignCustodySuccessMessageType
                  ](totalAssets)}
                </div>
              ) : (
                <p className="mb-4 text-success-500">
                  Successfully assigned the custody. You can close this dialog
                  now.
                </p>
              )}

              <Button
                className="w-full"
                variant="secondary"
                onClick={() => {
                  setIsSuccess(false);
                  handleCloseDialog();
                }}
              >
                Close
              </Button>
            </div>
          </When>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
