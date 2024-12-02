import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { NewBookingFormSchema } from "~/components/booking/form";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import FormRow from "~/components/forms/form-row";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { resolveTeamMemberName } from "~/utils/user";

export default function CreateBookingForSelectedAssetsDialog() {
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const zo = useZorm(
    "CretaeBookingWithAssets",
    NewBookingFormSchema(false, true)
  );

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="bookings"
      arrayFieldId="assetIds"
      title="Create booking"
      description={`Create a new booking with selected(${selectedAssets.length}) assets`}
      actionUrl="/bookings/new"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="max-h-[calc(100vh_-_200px)] overflow-auto">
          <Card className="m-0 mb-2">
            <FormRow
              rowLabel="Name"
              className="mobile-styling-only border-b-0 p-0"
              required
            >
              <Input
                label="Name"
                hideLabel
                name={zo.fields.name()}
                error={zo.errors.name()?.message}
                autoFocus
                className="mobile-styling-only w-full p-0"
                placeholder="Booking"
                required
                disabled={disabled}
              />
            </FormRow>
          </Card>
          <Card className="m-0 mb-2">
            <FormRow
              rowLabel="Start Date"
              className="mobile-styling-only border-b-0 pb-2.5 pt-0"
              required
            >
              <Input
                label="Start Date"
                type="datetime-local"
                hideLabel
                name={zo.fields.startDate()}
                disabled={disabled}
                error={zo.errors.startDate()?.message}
                className="w-full"
                placeholder="Booking"
                required
              />
            </FormRow>
            <FormRow
              rowLabel="End Date"
              className="mobile-styling-only mb-2.5 border-b-0 p-0"
              required
            >
              <Input
                label="End Date"
                type="datetime-local"
                hideLabel
                name={zo.fields.endDate()}
                disabled={disabled}
                error={zo.errors.endDate()?.message}
                className="w-full"
                placeholder="Booking"
                required
              />
            </FormRow>
            <p className="text-gray-600">
              Within this period the assets in this booking will be in custody
              and unavailable for other bookings.
            </p>
          </Card>
          <Card className="m-0 mb-2">
            <label className="mb-2.5 block font-medium text-gray-700">
              <span className="required-input-label">Custodian</span>
            </label>
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
              <div className="text-sm text-error-500">
                {zo.errors.custodian()?.message}
              </div>
            ) : null}
            <p className="mt-2 text-[14px] text-gray-600">
              The person that will be in custody of or responsible for the
              assets during the duration of the booking period.
            </p>
          </Card>
          <Card className="m-0 mb-2">
            <FormRow
              rowLabel="Description"
              className="mobile-styling-only border-b-0 p-0"
            >
              <Input
                label="Description"
                inputType="textarea"
                hideLabel
                name={zo.fields.description()}
                disabled={disabled}
                error={zo.errors.description()?.message}
                className="mobile-styling-only w-full p-0"
                placeholder="Add a description..."
              />
            </FormRow>
          </Card>
          {selectedAssets.map((asset, i) => (
            <input
              key={asset.id}
              type="hidden"
              name={`assetIds[${i}]`}
              value={asset.id}
            />
          ))}

          {fetcherError ? (
            <p className="text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <div className="flex items-center gap-3">
            <Button
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
