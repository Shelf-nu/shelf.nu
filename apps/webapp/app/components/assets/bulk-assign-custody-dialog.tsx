import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useRoleAccess } from "~/hooks/use-role-access";
import { createCustodianSchema } from "~/modules/custody/schema";
import { type loader } from "~/routes/_layout+/assets._index";
import {
  AssetQuantitiesSchema,
  AssetSourceLocationsSchema,
} from "~/utils/asset-quantities-schema";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { MAX_LIST_ITEMS } from "~/utils/zod";
import { QuantityTrackedSkipWarning } from "./quantity-tracked-skip-warning";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import DynamicSelect from "../dynamic-select/dynamic-select";
import { Button } from "../shared/button";

export const BulkAssignCustodySchema = z.object({
  assetIds: z.array(z.string()).max(MAX_LIST_ITEMS).min(1),
  custodian: createCustodianSchema(),
  /**
   * Units per quantity-tracked asset, sent only by the scanner, which shows a
   * quantity input on each scanned row. This dialog selects rows on the assets
   * index, where there is nowhere to say how many units each hand-over covers,
   * so it sends nothing and those assets keep being skipped.
   */
  quantities: AssetQuantitiesSchema,
  /**
   * Where each quantity-tracked asset's units come from, sent only by the
   * scanner, and only for pools placed at two or more locations. Keyed by
   * asset id: a location id or `"unplaced"`.
   */
  sourceLocations: AssetSourceLocationsSchema,
});

export default function BulkAssignCustodyDialog() {
  const zo = useZorm("BulkAssignCustody", BulkAssignCustodySchema);

  const assignsSelfOnly = useRoleAccess().custody.assign === "self";
  const { currentUserTeamMember } = useLoaderData<typeof loader>();

  const selectedItems = useAtomValue(selectedBulkItemsAtom);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="assign-custody"
      title={`${assignsSelfOnly ? "Take" : "Assign"} custody of assets`}
      description={`These assets are currently available. You're about to assign custody to ${
        assignsSelfOnly ? "yourself" : "one of your team members"
      }.`}
      actionUrl="/api/assets/bulk-assign-custody"
      arrayFieldId="assetIds"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="modal-content-wrapper">
          <QuantityTrackedSkipWarning
            selectedItems={selectedItems}
            instead="Quantity-tracked assets must be assigned custody individually with a specific quantity."
          />
          <div className="relative z-50 mb-8">
            {assignsSelfOnly && currentUserTeamMember ? (
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
                  // ASSET custody: SELF_SERVICE may only take custody itself
                  // and BASE never.
                  custodyPurpose: "custody-assignment",
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

          <div className={tw("flex gap-3", assignsSelfOnly && "-mt-8")}>
            <Button
              type="button"
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}
    </BulkUpdateDialogContent>
  );
}
