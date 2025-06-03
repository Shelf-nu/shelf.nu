import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { CustodianField } from "~/components/booking/forms/fields/custodian";
import { DatesFields } from "~/components/booking/forms/fields/dates";
import { DescriptionField } from "~/components/booking/forms/fields/description";
import { NameField } from "~/components/booking/forms/fields/name";
import { BookingFormSchema } from "~/components/booking/forms/forms-schema";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { useUserData } from "~/hooks/use-user-data";
import { useWorkingHours } from "~/hooks/use-working-hours";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getBookingDefaultStartEndTimes } from "~/utils/date-fns";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";

export default function CreateBookingForSelectedAssetsDialog() {
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const zo = useZorm(
    "CreateBookingWithAssets",
    BookingFormSchema({ action: "new" })
  );
  const { startDate, endDate: defaultEndDate } =
    getBookingDefaultStartEndTimes();
  const [endDate, setEndDate] = useState(defaultEndDate);
  const { isBaseOrSelfService, roles } = useUserRoleHelper();
  const { currentOrganization, teamMembers } =
    useLoaderData<AssetIndexLoaderData>();
  const user = useUserData();
  const defaultTeamMember = isBaseOrSelfService
    ? teamMembers.find((tm) => tm.userId === user!.id)
    : undefined;

  const userCanSeeCustodian = userCanViewSpecificCustody({
    roles,
    custodianUserId: defaultTeamMember?.userId || null,
    organization: currentOrganization,
    currentUserId: user?.id,
  });

  const workingHoursData = useWorkingHours(currentOrganization.id);

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="bookings"
      arrayFieldId="assetIds"
      title="Create booking"
      description={`Create a new booking with selected(${selectedAssets.length}) assets`}
      actionUrl="/bookings/new"
      className="lg:w-[600px]"
    >
      {({ disabled, handleCloseDialog, fetcherError }) => (
        <div className="max-h-[calc(100vh_-_200px)] overflow-auto">
          <Card className="m-0 mb-2">
            <NameField
              name={undefined}
              fieldName={zo.fields.name()}
              error={zo.errors.name()?.message}
              disabled={disabled}
              onChange={() => {}}
            />
          </Card>
          <Card className="m-0 mb-2">
            <DatesFields
              startDate={startDate}
              startDateName={zo.fields.startDate()}
              startDateError={zo.errors.startDate()?.message}
              endDate={endDate}
              endDateName={zo.fields.endDate()}
              endDateError={zo.errors.endDate()?.message}
              setEndDate={setEndDate}
              disabled={disabled}
              isNewBooking
              workingHoursData={workingHoursData}
            />
          </Card>
          <Card className="m-0 mb-2">
            <CustodianField
              defaultTeamMember={defaultTeamMember}
              disabled={disabled || isBaseOrSelfService}
              userCanSeeCustodian={userCanSeeCustodian}
              isNewBooking
              error={zo.errors.custodian()?.message}
            />
          </Card>
          <Card className="m-0 mb-2">
            <DescriptionField
              description={undefined}
              fieldName={zo.fields.description()}
              disabled={disabled}
              error={zo.errors.description()?.message}
            />
          </Card>

          {fetcherError ? (
            <p className="mt-2 text-sm text-error-500">{fetcherError}</p>
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
