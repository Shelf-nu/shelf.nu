import { Close } from "@radix-ui/react-dialog";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  ArrowRight,
  CheckIcon,
  ClockIcon,
  InfoIcon,
} from "lucide-react";
import { tw } from "~/utils/tw";
import { XIcon } from "../icons/library";
import { Button } from "../shared/button";
import { Sheet, SheetContent, SheetTrigger } from "../shared/sheet";

type BookingProcessSidebarProps = {
  className?: string;
};

type ProcessItem = {
  icon: LucideIcon;
  title: string;
  description: string;
  iconClassName: string;
};

const ITEMS: Array<ProcessItem> = [
  {
    icon: ClockIcon,
    title: "Submit Request",
    description: `Fill in all required information and select the assets you need. Click "Request Booking" to submit your request.`,
    iconClassName: "bg-blue-100 text-blue-500",
  },
  {
    icon: InfoIcon,
    title: "Admin Review",
    description:
      "An administrator will review your request and decide whether to approve it. Multiple booking requests for the same assets may be considered.",
    iconClassName: "bg-warning-100 text-warning-500",
  },
  {
    icon: CheckIcon,
    title: "Confirmation",
    description: `You'll receive an email notification when your booking is approved. The booking will also be marked as "Reserved" in the system.`,
    iconClassName: "bg-success-100 text-success-500",
  },
  {
    icon: ArrowRight,
    title: "Check-Out",
    description:
      "On the start date of your booking, an administrator will check out the equipment on your behalf. You'll be responsible for the equipment during your booking period.",
    iconClassName: "bg-violet-100 text-violet-500",
  },
  {
    icon: ArrowLeft,
    title: "Check-In",
    description:
      "At the end of you booking period, return the equipment to the administrator who will check in back into the system.",
    iconClassName: "bg-indigo-100 text-indigo-500",
  },
];

export default function BookingProcessSidebar({
  className,
}: BookingProcessSidebarProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="info">
          <div className="flex items-center gap-2">
            <InfoIcon className="size-4" />
            How bookings work
          </div>
        </Button>
      </SheetTrigger>

      <SheetContent
        hideCloseButton
        className={tw("border-l-0 bg-white p-0", className)}
      >
        <div className="flex items-center justify-between bg-blue-500 p-4 text-white">
          <div className="flex items-center gap-2 text-lg font-bold">
            <InfoIcon className="size-4" />
            Booking Process
          </div>

          <Close className="opacity-70 transition-opacity hover:opacity-100">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </Close>
        </div>

        <div className="p-4">
          <p className="mb-8 border-l-4 border-blue-500 bg-blue-50 p-2 text-blue-500">
            Base users submit booking requests that require admin approval.
            Admins handle equipment check-out and check-in.
          </p>

          <div className="mb-8 flex flex-col gap-4">
            {ITEMS.map((item, i) => (
              <div key={i} className="flex items-start gap-4">
                <div
                  className={tw(
                    "flex items-center justify-center rounded-full p-4",
                    item.iconClassName
                  )}
                >
                  {}
                  <item.icon className="size-5" />
                </div>

                <div>
                  <h3 className="mb-1">
                    {i + 1}. {item.title}
                  </h3>
                  <p>{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-md bg-gray-50 p-4">
            <h3 className="mb-1">Important Notes</h3>

            <ul className="list-inside list-disc">
              <li>
                Equipment must be returned in the same condition it was checked
                out.
              </li>
              <li>
                If you need to extend your booking, contact and administrator
                before your booking end date.
              </li>
              <li>
                Administrators have final say on booking approvals based on
                equipment availability and priorities.
              </li>
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
