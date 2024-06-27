import { useHydrated } from "remix-utils/use-hydrated";
import { tw } from "~/utils/tw";
import { useControlledDropdownMenu } from "~/utils/use-controlled-dropdown-menu";
import Icon from "../icons/icon";
import { ChevronRight } from "../icons/library";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";

export default function BulkActionsDropdown() {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return (
      <Button variant="secondary" to="#">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );
  }

  return (
    <div className="actions-dropdown flex">
      <ConditionalDropdown />
    </div>
  );
}

function ConditionalDropdown() {
  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50  transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}

      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (defaultApplied && window.innerWidth <= 640) setOpen(open);
        }}
        open={open}
        defaultOpen={defaultOpen}
      >
        <DropdownMenuTrigger
          className="actions-dropdown hidden sm:flex"
          onClick={() => setOpen(!open)}
          asChild
        >
          <Button variant="secondary">
            <span className="flex items-center gap-2">
              Actions <ChevronRight className="chev" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu trigger on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="secondary"
          className="asset-actions sm:hidden"
          onClick={() => setOpen(true)}
        >
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev" />
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
            }} // is a hack to fix the dropdown menu not being in the right place on mobile
            // can not target [data-radix-popper-content-wrapper] for this file only with css
            // so we have to use dangerouslySetInnerHTML
            // PR : https://github.com/Shelf-nu/shelf.nu/pull/304
          ></style>
        )}

        <DropdownMenuContent
          asChild
          align="end"
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            <DropdownMenuItem
              className="border-b px-4 py-1 md:p-0"
              //   disabled={assetIsCheckedOut && !assetCanBeReleased}
            >
              {/* {assetCanBeReleased ? ( */}
              <Button
                to="bulk-check-in"
                role="link"
                variant="link"
                className={tw(
                  "justify-start whitespace-nowrap px-4 py-3  text-gray-700 hover:text-gray-700"
                  //   assetIsPartOfUnavailableKit
                  // ? "pointer-events-none cursor-not-allowed opacity-50"
                  // : ""
                )}
                width="full"
                onClick={() => setOpen(false)}
                // disabled={assetIsPartOfUnavailableKit}
              >
                <span className="flex items-center gap-1">
                  <Icon icon="check-in" /> Check in
                </span>
              </Button>
              {/* ) : (
                <Button
                  to="overview/check-out"
                  role="link"
                  variant="link"
                  className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={() => setOpen(false)}
                >
                  <span className="flex items-center gap-2">
                    <Icon icon="check-out" /> Check out
                  </span>
                </Button>
              )} */}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={tw("px-4 py-1 md:p-0")}
              //   disabled={assetIsCheckedOut}
            >
              <Button
                to="bulk-update-location"
                role="link"
                variant="link"
                className={tw(
                  "justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                )}
                width="full"
                onClick={() => setOpen(false)}
              >
                <span className="flex items-center gap-2">
                  <Icon icon="location" /> Update location
                </span>
              </Button>
            </DropdownMenuItem>

            <DropdownMenuItem
              className={tw("px-4 py-1 md:p-0")}
              //   disabled={assetIsCheckedOut}
            >
              <Button
                to="bulk-update-category"
                role="link"
                variant="link"
                className={tw(
                  "justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                )}
                width="full"
                onClick={() => setOpen(false)}
              >
                <span className="flex items-center gap-2">
                  <Icon icon="category" /> Update category
                </span>
              </Button>
            </DropdownMenuItem>

            <DropdownMenuItem className="px-4 py-1 md:p-0">
              <Button
                to="bulk-delete"
                role="link"
                variant="link"
                className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                width="full"
                onClick={() => setOpen(false)}
              >
                <span className="flex items-center gap-2">
                  <Icon icon="trash" /> Delete
                </span>
              </Button>
            </DropdownMenuItem>

            <DropdownMenuItem className="border-t p-4 md:hidden md:p-0">
              <Button
                role="button"
                variant="secondary"
                className="flex items-center justify-center text-gray-700 hover:text-gray-700 "
                width="full"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </DropdownMenuItem>
            {/* {assetIsCheckedOut ? (
              <div className=" border-t p-2 text-left text-xs">
                Some actions are disabled due to the asset being checked out.
              </div>
            ) : null}
            {assetIsPartOfUnavailableKit ? (
              <div className=" border-t p-2 text-left text-xs">
                Some actions are disabled due to the asset being part of a kit.
              </div>
            ) : null} */}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
