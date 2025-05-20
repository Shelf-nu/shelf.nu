import { useEffect, useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { useAtom } from "jotai";
import { useZorm } from "react-zorm";
import { updateDynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { NewBookingLoaderReturnType } from "~/routes/_layout+/bookings.new";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";

import { tw } from "~/utils/tw";
import { Form } from "../../custom-form";
import { CustodianField } from "./fields/custodian";
import { DatesFields } from "./fields/dates";
import { DescriptionField } from "./fields/description";
import { NameField } from "./fields/name";
import { BookingFormSchema } from "./forms-schema";
import { Button } from "../../shared/button";
import { Card } from "../../shared/card";

type NewBookingFormData = {
  booking: {
    startDate: string;
    endDate: string;
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
  const {
    startDate,
    endDate: incomingEndDate,
    custodianRef,
    assetIds,
  } = booking;

  const { teamMembers, userId, currentOrganization } =
    useLoaderData<NewBookingLoaderReturnType>();
  const [endDate, setEndDate] = useState(incomingEndDate);

  const [, updateName] = useAtom(updateDynamicTitleAtom);

  const disabled = useDisabled();

  const zo = useZorm(
    "NewQuestionWizardScreen",
    BookingFormSchema({
      action: "new", // NOTE: in the front-end the action save basically handles the schema for reserve which is the same, the full schema
    })
  );

  const { roles, isBaseOrSelfService } = useUserRoleHelper();

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

  return (
    <div>
      <Form ref={zo.ref} method="post" action={action}>
        <div className="-mx-4 mb-4 md:mx-0">
          <div className={tw("mb-8 w-full lg:mb-0 ")}>
            <div className="flex w-full flex-col gap-3">
              <Card className="m-0">
                <NameField
                  name={undefined}
                  fieldName={zo.fields.name()}
                  disabled={disabled}
                  error={zo.errors.name()?.message}
                  onChange={updateName}
                />
              </Card>
              <Card className="m-0">
                <DatesFields
                  startDate={startDate}
                  startDateName={zo.fields.startDate()}
                  startDateError={zo.errors.startDate()?.message}
                  endDate={endDate}
                  endDateName={zo.fields.endDate()}
                  endDateError={zo.errors.endDate()?.message}
                  setEndDate={setEndDate}
                  disabled={disabled}
                  isNewBooking={true}
                />
              </Card>
              <Card className="m-0">
                <CustodianField
                  defaultTeamMember={defaultTeamMember}
                  disabled={disabled || isBaseOrSelfService}
                  userCanSeeCustodian={userCanSeeCustodian}
                  isNewBooking={true}
                  error={zo.errors.custodian()?.message}
                />
              </Card>
              <Card className="m-0">
                <DescriptionField
                  description={undefined}
                  fieldName={zo.fields.description()}
                  disabled={disabled}
                  error={zo.errors.description()?.message}
                />
              </Card>
            </div>
          </div>
        </div>
        <Card className="sticky bottom-0 -mx-6 mb-0 rounded-none border-0 px-6 py-0 text-right">
          <div className="-mx-6 mb-3 border-t shadow" />
          {assetIds?.map((item, i) => (
            <input
              key={item}
              type="hidden"
              name={`assetIds[${i}]`}
              value={item}
            />
          ))}
          <div className="flex flex-col">
            {!assetIds ? (
              <Button
                icon="scan"
                className="mb-1"
                type="submit"
                disabled={disabled}
                value="scan"
                name="intent"
              >
                Scan QR codes
              </Button>
            ) : null}
            <Button
              className="mb-3 whitespace-nowrap"
              icon={assetIds ? undefined : "rows"}
              value="create"
              name="intent"
              disabled={disabled}
            >
              {assetIds ? "Create Booking" : "View assets list"}
            </Button>
            <hr />
            <Button
              variant="secondary"
              to=".."
              width="full"
              disabled={disabled}
              className=" mt-3 whitespace-nowrap"
            >
              Cancel
            </Button>
          </div>
          <div className="h-3" />
        </Card>
      </Form>
    </div>
  );
}
