import type { Booking } from "@prisma/client";
import { ChevronRightIcon, ListChecks } from "lucide-react";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { tw } from "~/utils/tw";
import CheckinDialog from "./checkin-dialog";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";

type CheckinDropdownProps = {
  disabled?: boolean;
  booking: Pick<Booking, "id" | "name"> & {
    to: string | Date;
    from: string | Date;
  };
  portalContainer?: HTMLElement;
};

export default function CheckinDropdown({
  disabled,
  booking,
  portalContainer,
}: CheckinDropdownProps) {
  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  function closeMenu() {
    setOpen(false);
  }

  return (
    <>
      {open && (
        <div className="fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50 transition duration-300 ease-in-out md:hidden" />
      )}

      <DropdownMenu
        modal={false}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(openValue) => {
          if (defaultApplied && window.innerWidth <= 640) {
            setOpen(openValue);
          }
        }}
      >
        <DropdownMenuTrigger
          className="hidden sm:flex"
          onClick={() => {
            setOpen(!open);
          }}
          asChild
        >
          <Button disabled={disabled} className="grow" size="sm">
            <span className="flex items-center gap-2">
              Check-in <ChevronRightIcon className="chev size-4 rotate-90" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* Mobile button */}
        <Button
          className="flex-1 sm:hidden"
          onClick={() => setOpen(true)}
          disabled={disabled}
          size="sm"
        >
          <span className="flex items-center gap-2">
            Check-in <ChevronRightIcon className="chev size-4" />
          </span>
        </Button>

        {open && (
          <style
            dangerouslySetInnerHTML={{
              __html: `@media (max-width: 640px) {
                [data-radix-popper-content-wrapper] {
                  transform: none !important;
                  will-change: auto !important;
                }
              }`,
            }}
          />
        )}

        <DropdownMenuContent
          ref={dropdownRef}
          asChild
          className="order actions-dropdown w-screen rounded-b-none rounded-t bg-white p-0 text-right md:static md:w-56"
          align="end"
          portalContainer={portalContainer}
        >
          <div className="fixed bottom-0 left-0">
            <DropdownMenuItem className="py-1 lg:p-0">
              <CheckinDialog
                booking={booking}
                disabled={disabled}
                portalContainer={portalContainer}
                onClose={closeMenu}
                label="Quick check-in"
                variant="dropdown"
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1 lg:p-0">
              <Button
                variant="link"
                className={tw(
                  "w-full justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
                )}
                width="full"
                onClick={closeMenu}
                disabled={disabled}
                to={`/bookings/${booking.id}/overview/checkin-assets`}
              >
                <span className="flex items-center gap-2">
                  <ListChecks className="size-4" /> Explicit check-in
                </span>
              </Button>
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
