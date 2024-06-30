import { useZorm } from "react-zorm";
import { z } from "zod";
import { resolveTeamMemberName } from "~/utils/user";
import { stringToJSONSchema } from "~/utils/zod";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

export const BulkCheckoutAssetsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
  custodian: stringToJSONSchema.pipe(
    z.object({ id: z.string(), name: z.string() })
  ),
});

export default function BulkCheckoutDialog() {
  const zo = useZorm("BulkCheckoutAsset", BulkCheckoutAssetsSchema);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="check-out"
      title="Check out assets"
      description="These assets are currently available. You're about to assign custody to one of your team members."
      actionUrl="/api/assets/bulk-check-out"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <div className="relative z-50 mb-8">
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

          <div className="flex gap-3">
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
