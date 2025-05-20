import { useEffect, useState } from "react";
import type { BookingStatus } from "@prisma/client";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { NewBookingLoaderReturnType } from "~/routes/_layout+/bookings.new";
import { isFormProcessing } from "~/utils/form";
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
import { AbsolutePositionedHeaderActions } from "../../layout/header/absolute-positioned-header-actions";
import { Button } from "../../shared/button";
import { Card } from "../../shared/card";
import When from "../../when/when";
import { ActionsDropdown } from "../actions-dropdown";
import BookingProcessSidebar from "../booking-process-sidebar";
import CheckinDialog from "../checkin-dialog";
import CheckoutDialog from "../checkout-dialog";
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
    startDate,
    endDate: incomingEndDate,
    custodianRef,
    bookingFlags,
    description,
    status,
  } = booking;

  const bookingStatus = useBookingStatusHelpers(status);
  const { teamMembers, userId, currentOrganization } =
    useLoaderData<NewBookingLoaderReturnType>();
  const [endDate, setEndDate] = useState(incomingEndDate);

  const [, updateName] = useAtom(updateDynamicTitleAtom);

  const isProcessing = isFormProcessing(navigation.state);

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

  const zo = useZorm(
    "NewQuestionWizardScreen",
    BookingFormSchema({
      action: "save", // NOTE: in the front-end the action save basically handles the schema for reserve which is the same, the full schema
      status,
    })
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
  const defaultTeamMember = teamMembers?.find(
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
   */

  const canSeeActions =
    !isBaseOrSelfService ||
    (isBaseOrSelfService &&
      (defaultTeamMember?.userId === userId ||
        defaultTeamMember?.id === userId));

  return (
    <div>
      <Form ref={zo.ref} method="post" action={action}>
        {/* Render the actions on top only when the form is in edit mode */}
        {canSeeActions ? (
          <AbsolutePositionedHeaderActions>
            <When truthy={isBase}>
              <BookingProcessSidebar />
            </When>

            {/* When the booking is Completed, there are no actions available for BASE role so we don't render it */}
            <ActionsDropdown />

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
                />
                <Button
                  type="submit"
                  disabled={disabled}
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
                  !bookingFlags?.hasAssets ||
                  bookingFlags?.hasAlreadyBookedAssets ||
                  bookingFlags?.hasUnavailableAssets
                    ? {
                        reason: bookingFlags?.hasUnavailableAssets
                          ? "You have some assets in your booking that are marked as unavailble. Either remove the assets from this booking or make them available again"
                          : bookingFlags?.hasAlreadyBookedAssets
                          ? "Your booking has assets that are already booked for the desired period. You need to resolve that before you can reserve"
                          : isProcessing
                          ? undefined
                          : "You need to add assets to your booking before you can reserve it",
                      }
                    : false
                }
                type="submit"
                name="intent"
                value="reserve"
                className="grow"
                size="sm"
              >
                {isBase ? "Request reservation" : "Reserve"}
              </Button>
            ) : null}

            {/* When booking is reserved, we show the check-out button */}
            <When truthy={bookingStatus?.isReserved && canCheckOutBooking}>
              <CheckoutDialog
                portalContainer={zo.form}
                booking={{ id, name: name!, from: startDate! }}
                disabled={
                  disabled ||
                  bookingFlags?.hasUnavailableAssets ||
                  bookingFlags?.hasCheckedOutAssets ||
                  bookingFlags?.hasAssetsInCustody
                    ? {
                        reason: bookingFlags?.hasAssetsInCustody
                          ? "Some assets in this booking are currently in custody. You need to resolve that before you can check-out"
                          : isProcessing
                          ? undefined
                          : "Some assets in this booking are not Available because they’re part of an Ongoing or Overdue booking",
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
              <CheckinDialog
                portalContainer={zo.form}
                booking={{ id, name: name!, to: endDate! }}
                disabled={disabled}
              />
            </When>
          </AbsolutePositionedHeaderActions>
        ) : null}
        <div className="-mx-4 mb-4 md:mx-0">
          <div className={tw("mb-8 w-full lg:mb-0")}>
            <Card className="mt-0 flex w-full flex-col gap-3">
              {id ? <input type="hidden" name="id" defaultValue={id} /> : null}
              <h3>Booking details</h3>
              <div className="flex gap-3">
                <div>
                  <div>
                    <NameField
                      name={name || undefined}
                      fieldName={zo.fields.name()}
                      disabled={
                        disabled ||
                        bookingStatus?.isCompleted ||
                        bookingStatus?.isCancelled ||
                        bookingStatus?.isArchived
                      }
                      error={zo.errors.name()?.message}
                      onChange={updateName}
                    />
                  </div>
                  <div className="mt-[10px]">
                    <DatesFields
                      startDate={startDate}
                      startDateName={zo.fields.startDate()}
                      startDateError={zo.errors.startDate()?.message}
                      endDate={endDate}
                      endDateName={zo.fields.endDate()}
                      endDateError={zo.errors.endDate()?.message}
                      setEndDate={setEndDate}
                      disabled={inputFieldIsDisabled}
                    />
                  </div>
                  <div className="mt-[10px]">
                    <CustodianField
                      defaultTeamMember={defaultTeamMember}
                      disabled={
                        disabled || isBaseOrSelfService || inputFieldIsDisabled
                      }
                      userCanSeeCustodian={userCanSeeCustodian}
                      error={zo.errors.custodian()?.message}
                    />
                  </div>
                </div>
                <div>
                  <div className="m-0 h-full [&_.input-wrapper]:h-full [&_label]:h-full [&_textarea]:h-full">
                    <DescriptionField
                      description={description || undefined}
                      fieldName={zo.fields.description()}
                      disabled={
                        disabled ||
                        bookingStatus?.isCompleted ||
                        bookingStatus?.isCancelled ||
                        bookingStatus?.isArchived
                      }
                      error={zo.errors.description()?.message}
                    />
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </Form>
    </div>
  );
}
