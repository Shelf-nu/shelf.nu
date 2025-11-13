import { cloneElement, useState } from "react";
import type { TeamMember } from "@prisma/client";
import { CalendarRangeIcon } from "lucide-react";
import { useLoaderData } from "react-router";
import { useSearchParams } from "~/hooks/search-params";
import { useUserData } from "~/hooks/use-user-data";
import { tw } from "~/utils/tw";
import { NewBookingForm } from "./forms/new-booking-form";
import { Dialog, DialogPortal } from "../layout/dialog";

type CreateBookingDialogProps = {
  className?: string;
  trigger: React.ReactElement<{ onClick: () => void }>;
};

export default function CreateBookingDialog({
  className,
  trigger,
}: CreateBookingDialogProps) {
  const { teamMembersForForm, isSelfServiceOrBase } = useLoaderData<{
    teamMembersForForm: TeamMember[];
    isSelfServiceOrBase: boolean;
  }>();
  const user = useUserData();

  // The loader already takes care of returning only the current user so we just get the first and only element in the array
  const custodianRef = isSelfServiceOrBase
    ? teamMembersForForm.find((tm) => tm.userId === user!.id)?.id
    : undefined;

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchParams] = useSearchParams();

  const assetIds = searchParams.getAll("assetId");

  function openDialog() {
    setIsDialogOpen(true);
  }

  function closeDialog() {
    setIsDialogOpen(false);
  }

  return (
    <>
      {cloneElement(trigger, { onClick: openDialog })}

      <DialogPortal>
        <Dialog
          className={tw(
            "overflow-auto py-0 md:max-h-[85vh] lg:w-[600px]",
            className
          )}
          open={isDialogOpen}
          onClose={closeDialog}
          title={
            <div className="mt-4 inline-flex items-center justify-center rounded-full border-4 border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
              <CalendarRangeIcon />
            </div>
          }
        >
          <div className="px-6 py-4">
            <div className="mb-5">
              <h4>Create new booking</h4>
              <p>
                Choose a name for your booking, select a start and end time and
                choose the custodian. Based on the selected information, asset
                availability will be determined.
              </p>
            </div>

            <NewBookingForm
              booking={{
                assetIds: assetIds.length ? assetIds : undefined,
                custodianRef,
              }}
              action="/bookings/new"
            />
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
