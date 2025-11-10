import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { TagsAutocomplete } from "~/components/tag/tags-autocomplete";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useDisabled } from "~/hooks/use-disabled";
import { useWorkingHours } from "~/hooks/use-working-hours";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getBookingDefaultStartEndTimes } from "~/modules/working-hours/utils";
import type {
  NewBookingActionReturnType,
  NewBookingLoaderReturnType,
} from "~/routes/_layout+/bookings.new";
import { useHints } from "~/utils/client-hints";

import { getValidationErrors } from "~/utils/http";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { tw } from "~/utils/tw";
import { CustodianField } from "./fields/custodian";
import { DatesFields } from "./fields/dates";
import { DescriptionField } from "./fields/description";
import { NameField } from "./fields/name";
import { BookingFormSchema, type BookingFormSchemaType } from "./forms-schema";
import { Button } from "../../shared/button";
import { Card } from "../../shared/card";

type NewBookingFormData = {
  booking: {
    custodianRef?: string; // This is a stringified value for custodianRef. It can be either a team member id or a user id
    assetIds?: string[] | null;
  };

  /**
   * In case if the form is rendered outside of /edit or /new booking,
   * then we can pass `action` to submit form
   */
  action?: string;
};

export function NewBookingForm({ booking, action }: NewBookingFormData) {
  const fetcher = useFetcher<NewBookingActionReturnType>();
  const { custodianRef, assetIds } = booking;

  const { teamMembers, teamMembersForForm, userId, currentOrganization, tags } =
    useLoaderData<NewBookingLoaderReturnType>();
  const tagsSuggestions = tags.map((tag) => ({
    label: tag.name,
    value: tag.id,
  }));
  const [, updateName] = useAtom(updateDynamicTitleAtom);

  const disabled = useDisabled(fetcher);
  const hints = useHints();

  // Fetch working hours for validation
  const workingHoursData = useWorkingHours(currentOrganization.id);
  const { workingHours } = workingHoursData;
  const bookingSettings = useBookingSettings();
  const { startDate: defaultStartDate, endDate: defaultEndDate } =
    getBookingDefaultStartEndTimes(
      workingHours,
      bookingSettings.bufferStartTime
    );

  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);

  const zo = useZorm(
    "NewQuestionWizardScreen",
    BookingFormSchema({
      hints,
      action: "new",
      workingHours: workingHours,
      bookingSettings,
    })
  );

  const { roles, isBaseOrSelfService } = useUserRoleHelper();

  /** Use teamMembersForForm when available (from dialog contexts), otherwise fall back to teamMembers */
  const teamMembersToUse = teamMembersForForm || teamMembers;

  /** This is used when we have selfSErvice or Base as we are setting the default */
  const defaultTeamMember = teamMembersToUse?.find(
    (m) => m.userId === custodianRef || m.id === custodianRef
  );

  const userCanSeeCustodian = userCanViewSpecificCustody({
    roles,
    custodianUserId: defaultTeamMember?.user?.id,
    organization: currentOrganization,
    currentUserId: userId,
  });

  useEffect(
    function updateEndDate() {
      if (defaultEndDate) {
        setEndDate(defaultEndDate);
      }
    },
    [defaultEndDate]
  );

  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<BookingFormSchemaType>(
    fetcher.data?.error
  );

  return (
    <div>
      <fetcher.Form ref={zo.ref} method="post" action={action}>
        <div className="-mx-4 mb-4 md:mx-0">
          <div className={tw("mb-8 w-full lg:mb-0 ")}>
            <div className="flex w-full flex-col gap-3">
              <Card className="field-card m-0">
                <NameField
                  name={undefined}
                  fieldName={zo.fields.name()}
                  disabled={disabled}
                  error={
                    validationErrors?.name?.message || zo.errors.name()?.message
                  }
                  onChange={updateName}
                />
              </Card>
              <Card className="field-card m-0">
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
                  isNewBooking={true}
                  workingHoursData={workingHoursData}
                />
              </Card>
              <Card className="field-card m-0">
                <CustodianField
                  defaultTeamMember={defaultTeamMember}
                  disabled={disabled || isBaseOrSelfService}
                  userCanSeeCustodian={userCanSeeCustodian}
                  isNewBooking={true}
                  error={
                    validationErrors?.custodian?.message ||
                    zo.errors.custodian()?.message
                  }
                />
              </Card>
              <Card className="field-card m-0 overflow-visible">
                <TagsAutocomplete
                  existingTags={[]}
                  suggestions={tagsSuggestions}
                  required={bookingSettings.tagsRequired}
                  error={
                    validationErrors?.tags?.message || zo.errors.tags()?.message
                  }
                />
              </Card>
              <Card className="field-card m-0">
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
            </div>
          </div>
        </div>
        <Card className="field-card sticky bottom-0 -mx-6 mb-0 rounded-none border-0 px-6 py-0 text-right">
          <div className="-mx-6 mb-3 border-t shadow" />
          {assetIds?.map((item, i) => (
            <input
              key={item}
              type="hidden"
              name={`assetIds[${i}]`}
              value={item}
            />
          ))}
          <div className={tw("actions-wrapper flex flex-col gap-2")}>
            {!assetIds ? (
              <Button
                icon="scan"
                className="whitespace-nowrap"
                type="submit"
                disabled={disabled}
                value="scan"
                name="intent"
                width={"full"}
              >
                Scan QR codes
              </Button>
            ) : null}
            <Button
              className="whitespace-nowrap"
              icon={assetIds ? undefined : "rows"}
              value="create"
              name="intent"
              disabled={disabled}
              width={"full"}
            >
              {assetIds ? "Create Booking" : "View assets list"}
            </Button>
            <hr />
            <Button
              variant="secondary"
              to=".."
              width="full"
              disabled={disabled}
              className="cancellation-button whitespace-nowrap"
            >
              Cancel
            </Button>
          </div>
          <div className="h-3" />
        </Card>
      </fetcher.Form>
    </div>
  );
}
