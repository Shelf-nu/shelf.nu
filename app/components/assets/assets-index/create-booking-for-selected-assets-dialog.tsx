import { useEffect, useState } from "react";
import { useLoaderData } from "react-router";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { CustodianField } from "~/components/booking/forms/fields/custodian";
import { DatesFields } from "~/components/booking/forms/fields/dates";
import { DescriptionField } from "~/components/booking/forms/fields/description";
import { NameField } from "~/components/booking/forms/fields/name";
import type { BookingFormSchemaType } from "~/components/booking/forms/forms-schema";
import { BookingFormSchema } from "~/components/booking/forms/forms-schema";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { TagsAutocomplete } from "~/components/tag/tags-autocomplete";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useUserData } from "~/hooks/use-user-data";
import { useWorkingHours } from "~/hooks/use-working-hours";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getBookingDefaultStartEndTimes } from "~/modules/working-hours/utils";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getValidationErrors } from "~/utils/http";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";

export default function CreateBookingForSelectedAssetsDialog() {
  const { currentOrganization, teamMembers, teamMembersForForm, tagsData } =
    useLoaderData<AssetIndexLoaderData>();
  const tagsSuggestions = tagsData.tags.map((tag) => ({
    label: tag.name,
    value: tag.id,
  }));
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const workingHoursData = useWorkingHours(currentOrganization.id);
  const { workingHours } = workingHoursData;
  const bookingSettings = useBookingSettings();
  const zo = useZorm(
    "CreateBookingWithAssets",
    BookingFormSchema({
      action: "new",
      workingHours,
      bookingSettings,
    })
  );

  const { startDate: defaultStartDate, endDate: defaultEndDate } =
    getBookingDefaultStartEndTimes(
      workingHours,
      bookingSettings.bufferStartTime
    );
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const { isBaseOrSelfService, roles } = useUserRoleHelper();

  const user = useUserData();
  // Use teamMembersForForm for BASE/SELF_SERVICE users to ensure their team member is always available
  const teamMembersToUse = teamMembersForForm || teamMembers;
  const defaultTeamMember = isBaseOrSelfService
    ? teamMembersToUse.find((tm) => tm.userId === user!.id)
    : undefined;

  const userCanSeeCustodian = userCanViewSpecificCustody({
    roles,
    custodianUserId: defaultTeamMember?.userId || null,
    organization: currentOrganization,
    currentUserId: user?.id,
  });

  useEffect(
    function updateEndDate() {
      if (defaultEndDate) {
        setEndDate(defaultEndDate);
      }
    },
    [defaultEndDate]
  );

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
      {({ disabled, handleCloseDialog, fetcherError, fetcherData }) => {
        /** This handles server side errors in case client side validation fails */
        const validationErrors = getValidationErrors<BookingFormSchemaType>(
          fetcherData?.error
        );
        return (
          <div className="max-h-[calc(100vh_-_200px)] overflow-auto">
            <Card className="m-0 mb-2">
              <NameField
                name={undefined}
                fieldName={zo.fields.name()}
                error={
                  validationErrors?.name?.message || zo.errors.name()?.message
                }
                disabled={disabled}
                onChange={() => {}}
              />
            </Card>
            <Card className="m-0 mb-2">
              <DatesFields
                startDate={startDate}
                startDateName={zo.fields.startDate()}
                startDateError={
                  validationErrors?.startDate?.message ||
                  zo.errors.startDate()?.message
                }
                setStartDate={setStartDate}
                endDate={endDate}
                endDateName={zo.fields.endDate()}
                endDateError={
                  validationErrors?.endDate?.message ||
                  zo.errors.endDate()?.message
                }
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
                error={
                  validationErrors?.custodian?.message ||
                  zo.errors.custodian()?.message
                }
              />
            </Card>

            <Card className="m-0 mb-2 overflow-visible">
              <TagsAutocomplete
                existingTags={[]}
                suggestions={tagsSuggestions}
                required={bookingSettings.tagsRequired}
                error={
                  validationErrors?.tags?.message || zo.errors.tags()?.message
                }
              />
            </Card>

            <Card className="m-0">
              <DescriptionField
                description={undefined}
                fieldName={zo.fields.description()}
                disabled={disabled}
                error={
                  validationErrors?.description?.message ||
                  zo.errors.description()?.message
                }
              />
            </Card>

            {fetcherError && !validationErrors ? (
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
        );
      }}
    </BulkUpdateDialogContent>
  );
}
