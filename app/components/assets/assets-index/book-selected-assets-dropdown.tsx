import { useAtomValue } from "jotai";
import { ChevronRightIcon } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import Icon from "~/components/icons/icon";
import { Button } from "~/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useCurrentOrganization } from "~/hooks/use-current-organization-id";
import { isSelectingAllItems } from "~/utils/list";
import { isPersonalOrg } from "~/utils/organization";
import { tw } from "~/utils/tw";

export default function BookSelectedAssetsDropdown() {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    <Button variant="secondary">
      <span className="flex items-center gap-2">
        Book <ChevronRightIcon className="chev size-4" />
      </span>
    </Button>;
  }

  return <ConditionalActionsDropdown />;
}

function ConditionalActionsDropdown() {
  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();
  const organization = useCurrentOrganization();
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);

  if (isPersonalOrg(organization)) {
    return null;
  }

  const allSelected = isSelectingAllItems(selectedAssets);
  const buttonTitle = `Export selection ${
    !selectedAssets.length
      ? ""
      : allSelected
      ? "(All)"
      : `(${selectedAssets.length})`
  }`;

  const someAssetsPartOfKit = selectedAssets.some((asset) => !!asset.kit);
  const kitDisableReason = someAssetsPartOfKit
    ? {
        reason:
          "Cannot book assets directly because some of the assets are part of a kit.",
      }
    : false;

  const someAssetsMarkedUnavailable = selectedAssets.some(
    (asset) => !asset.availableToBook
  );
  const unavailableDisableReason = someAssetsMarkedUnavailable
    ? { reason: "Some of the assets are marked as unavailable." }
    : false;

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
          <Button disabled={kitDisableReason ?? unavailableDisableReason}>
            <span className="flex items-center gap-2">
              {buttonTitle} <ChevronRightIcon className="chev size-4" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu triggerer on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          className="sm:hidden"
          onClick={() => setOpen(true)}
          disabled={kitDisableReason ?? unavailableDisableReason}
        >
          <span className="flex items-center gap-2">
            {buttonTitle} <ChevronRightIcon className="chev size-4" />
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
          ref={dropdownRef}
          asChild
          className="order actions-dropdown w-screen rounded-b-none rounded-t bg-white p-0 text-right md:static md:w-56"
        >
          <div className="fixed bottom-0 left-0">
            <Button
              disabled={kitDisableReason ?? unavailableDisableReason}
              to="overview/release-custody"
              role="link"
              variant="link"
              className="justify-start whitespace-nowrap px-4 py-3  text-gray-700 hover:text-gray-700"
              width="full"
            >
              <span className="flex items-center gap-2">
                <Icon icon="bookings" /> Create new booking
              </span>
            </Button>
            <Button
              disabled={kitDisableReason ?? unavailableDisableReason}
              to="overview/release-custody"
              role="link"
              variant="link"
              className="justify-start whitespace-nowrap px-4 py-3  text-gray-700 hover:text-gray-700"
              width="full"
            >
              <span className="flex items-center gap-2">
                <Icon icon="booking-exist" /> Add to existing booking
              </span>
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
