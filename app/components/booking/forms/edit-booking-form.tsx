import { useEffect, useState } from "react";
import type { BookingStatus, Tag } from "@prisma/client";
import { useAtom } from "jotai";
import { useActionData, useLoaderData, useNavigation } from "react-router";
import { useZorm } from "react-zorm";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useWorkingHours } from "~/hooks/use-working-hours";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type {
  BookingPageActionData,
  BookingPageLoaderData,
} from "~/routes/_layout+/bookings.$bookingId.overview";
import { useHints } from "~/utils/client-hints";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { Form } from "../../custom-form";
import { CustodianField } from "./fields/custodian";
import { DatesFields } from "./fields/dates";
import { DescriptionField } from "./fields/description";
import { NameField } from "./fields/name";
import TagField from "./fields/tag-field";
import { AbsolutePositionedHeaderActions } from "../../layout/header/absolute-positioned-header-actions";
import { Button } from "../../shared/button";
import When from "../../when/when";
import { ActionsDropdown } from "../actions-dropdown";
import BookingProcessSidebar from "../booking-process-sidebar";
import CheckinDropdown from "../checkin-dropdown";
import CheckoutDialog from "../checkout-dialog";
import type { BookingFormSchemaType } from "./forms-schema";
import { BookingFormSchema } from "./forms-schema";

type BookingFlags = {
  hasAssets: boolean;
  hasUnavailableAssets: boolean;
  hasCheckedOutAssets: boolean;
  hasAlreadyBookedAssets: boolean;
  hasAssetsInCustody: boolean;
};

type BookingFormData = {
  booking: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    custodianRef: string; // This is a stringified value for custodianRef. It can be either a team member id or a user id
    bookingFlags: BookingFlags;
    description: string | null;
    status: BookingStatus;
    tags: Pick<Tag, "id" | "name">[];
  };

  /**
   * In case if the form is rendered outside of /edit or /new booking,
   * then we can pass `action` to submit form
   */
  action?: string;
};

export function EditBookingForm({ booking, action }: BookingFormData) {
  const navigation = useNavigation();
  const {
    id,
    name,
    startDate: incomingStartDate,
    endDate: incomingEndDate,
    custodianRef,
    bookingFlags,
    description,
    status,
    tags,
  } = booking;

  const bookingStatus = useBookingStatusHelpers(status);
  const { teamMembers, teamMembersForForm, userId, currentOrganization } =
    useLoaderData<BookingPageLoaderData>();
  const [startDate, setStartDate] = useState(incomingStartDate);
  const [endDate, setEndDate] = useState(incomingEndDate);

  const [, updateName] = useAtom(updateDynamicTitleAtom);

  const isProcessing = isFormProcessing(navigation.state);
  const hints = useHints();

  // Fetch working hours for validation
  const workingHoursData = useWorkingHours(currentOrganization.id);
  const { workingHours, isLoading: isLoadingWorkingHours } = workingHoursData;

  const disabled = isProcessing || bookingStatus?.isArchived;

  const inputFieldIsDisabled =
    disabled ||
    Boolean(
      bookingStatus?.isReserved ||
        bookingStatus?.isOngoing ||
        bookingStatus?.isCompleted ||
        bookingStatus?.isOverdue ||
        bookingStatus?.isCancelled
    );
  const bookingSettings = useBookingSettings();

  const zo = useZorm(
    "NewQuestionWizardScreen",
    BookingFormSchema({
      hints,
      action: "save", // NOTE: in the front-end the action save basically handles the schema for reserve which is the same, the full schema
      status,
      workingHours: workingHours,
      bookingSettings,
    })
  );

  const actionData = useActionData<BookingPageActionData>();
  /** This handles server side errors in case client side validation fails */
  const validationErrors = getValidationErrors<BookingFormSchemaType>(
    actionData?.error
  );

  const { roles, isBaseOrSelfService, isBase } = useUserRoleHelper();

  const canCheckInBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.checkin,
  });
  const canCheckOutBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.checkout,
  });

  /** This is used when we have selfSErvice or Base as we are setting the default */
  // Use teamMembersForForm for BASE/SELF_SERVICE users to ensure their team member is always available
  const teamMembersToUse = teamMembersForForm || teamMembers;
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
      if (incomingEndDate) {
        setEndDate(incomingEndDate);
      }
    },
    [incomingEndDate]
  );

  /**
   * Check whether the user can see actions
   * 1. Admin/Owner always can see all
   * 2. SELF_SERVICE can see actions if they are the custodian of the booking
   * 3. BASE can see actions if they are the custodian of the booking
   * This is also used to disabled the name & description fields
   *
   */
  const canSeeActions =
    !isBaseOrSelfService ||
    (isBaseOrSelfService &&
      (defaultTeamMember?.userId === userId ||
        defaultTeamMember?.id === userId));

  return (
    <Form
      ref={zo.ref}
      method="post"
      action={action}
      className="edit-booking-form"
    >
      {/* Render the actions on top only when the form is in edit mode */}
      {canSeeActions ? (
        <AbsolutePositionedHeaderActions>
          <div className="flex flex-1 items-center justify-between gap-2">
            <When truthy={isBase}>
              <BookingProcessSidebar />
            </When>

            {/* When the booking is Completed, there are no actions available for BASE role so we don't render it */}
            <ActionsDropdown />
          </div>
          <div className="flex items-center justify-between gap-2">
            {/*  We show the button in all cases, unless the booking is in a final state */}
            {!(
              bookingStatus?.isCompleted ||
              bookingStatus?.isCancelled ||
              bookingStatus?.isArchived
            ) ? (
              <>
                <input
                  type="hidden"
                  name="nameChangeOnly"
                  value={bookingStatus?.isDraft ? "no" : "yes"}
                  key={id}
                />
                <Button
                  type="submit"
                  disabled={disabled || isLoadingWorkingHours}
                  variant="secondary"
                  name="intent"
                  value="save"
                  className="grow"
                  size="sm"
                >
                  Save
                </Button>
              </>
            ) : null}

            {/* When booking is draft, we show the reserve button */}
            {bookingStatus?.isDraft ? (
              <Button
                disabled={
                  disabled ||
                  isLoadingWorkingHours ||
                  !bookingFlags?.hasAssets ||
                  bookingFlags?.hasAlreadyBookedAssets ||
                  bookingFlags?.hasUnavailableAssets
                    ? {
                        reason: bookingFlags?.hasUnavailableAssets
                          ? "You have some assets in your booking that are marked as unavailble. Either remove the assets from this booking or make them available again"
                          : bookingFlags?.hasAlreadyBookedAssets
                          ? "Your booking has assets that are already booked for the desired period. You need to resolve that before you can reserve"
                          : isProcessing || isLoadingWorkingHours
                          ? undefined
                          : "You need to add assets to your booking before you can reserve it",
                      }
                    : false
                }
                type="submit"
                name="intent"
                value="reserve"
                className="grow whitespace-nowrap"
                size="sm"
              >
                {isBase ? "Request reservation" : "Reserve"}
              </Button>
            ) : null}

            {/* When booking is reserved, we show the check-out button */}
            <When truthy={bookingStatus?.isReserved && canCheckOutBooking}>
              <CheckoutDialog
                portalContainer={zo.form}
                booking={{ id, name: name!, from: new Date(startDate!) }}
                disabled={
                  disabled ||
                  isLoadingWorkingHours ||
                  bookingFlags?.hasUnavailableAssets ||
                  bookingFlags?.hasAlreadyBookedAssets ||
                  bookingFlags?.hasCheckedOutAssets ||
                  bookingFlags?.hasAssetsInCustody
                    ? {
                        reason: bookingFlags?.hasAssetsInCustody
                          ? "Some assets in this booking are currently in custody. You need to resolve that before you can check-out"
                          : bookingFlags?.hasAlreadyBookedAssets
                          ? "Your booking has assets that are already booked for the desired period. You need to resolve that before you can check-out"
                          : isProcessing || isLoadingWorkingHours
                          ? undefined
                          : "Some assets in this booking are not Available because they're part of an Ongoing or Overdue booking",
                      }
                    : false
                }
              />
            </When>

            <When
              truthy={
                (bookingStatus?.isOngoing || bookingStatus?.isOverdue) &&
                canCheckInBooking
              }
            >
              <CheckinDropdown
                portalContainer={zo.form}
                booking={{
                  id,
                  name: name!,
                  to: new Date(endDate),
                  from: new Date(startDate),
                }}
                disabled={disabled || isLoadingWorkingHours}
              />
            </When>
          </div>
        </AbsolutePositionedHeaderActions>
      ) : null}
      <div className="mb-4">
        <div className="m-0 flex w-full flex-col gap-3">
          {id ? (
            <input type="hidden" name="id" defaultValue={id} key={id} />
          ) : null}
          <h3>Booking details</h3>
          <div
            className={tw(
              "flex flex-col gap-3 lg:flex-row",
              "[&_.form-row-children-wrapper]:w-full"
            )}
          >
            <div className="w-full lg:w-2/5">
              <div>
                <NameField
                  key={id}
                  name={name || undefined}
                  fieldName={zo.fields.name()}
                  disabled={
                    disabled ||
                    isLoadingWorkingHours ||
                    bookingStatus?.isCompleted ||
                    bookingStatus?.isCancelled ||
                    bookingStatus?.isArchived ||
                    !canSeeActions
                  }
                  error={
                    validationErrors?.name?.message || zo.errors.name()?.message
                  }
                  onChange={updateName}
                />
              </div>
              <div className="mt-[10px]">
                <DatesFields
                  key={`${id}-dates`}
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
                  disabled={inputFieldIsDisabled}
                  workingHoursData={workingHoursData}
                />
              </div>
              <div className="mt-[10px]">
                <CustodianField
                  key={`${id}-custodian`}
                  defaultTeamMember={defaultTeamMember}
                  disabled={
                    disabled ||
                    isLoadingWorkingHours ||
                    isBaseOrSelfService ||
                    inputFieldIsDisabled
                  }
                  userCanSeeCustodian={userCanSeeCustodian}
                  error={
                    validationErrors?.custodian?.message ||
                    zo.errors.custodian()?.message
                  }
                />
              </div>
            </div>
            <div className="w-full lg:w-3/5">
              <div
                className={tw(
                  "m-0 flex h-full flex-col",
                  "[&_.input-wrapper]:h-full [&_label]:h-full [&_textarea]:size-full"
                )}
              >
                <TagField
                  key={`${id}-tags`}
                  disabled={
                    disabled ||
                    isLoadingWorkingHours ||
                    bookingStatus?.isCompleted ||
                    bookingStatus?.isCancelled ||
                    bookingStatus?.isArchived ||
                    !canSeeActions
                  }
                  existingTags={tags}
                  className="mb-2.5"
                  required={bookingSettings.tagsRequired}
                  error={
                    validationErrors?.tags?.message || zo.errors.tags()?.message
                  }
                />

                <DescriptionField
                  key={`${id}-description`}
                  description={description || undefined}
                  fieldName={zo.fields.description()}
                  disabled={
                    disabled ||
                    isLoadingWorkingHours ||
                    bookingStatus?.isCompleted ||
                    bookingStatus?.isCancelled ||
                    bookingStatus?.isArchived ||
                    !canSeeActions
                  }
                  error={
                    validationErrors?.description?.message ||
                    zo.errors.description()?.message
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Form>
  );
}
