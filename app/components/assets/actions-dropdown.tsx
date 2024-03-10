import { useEffect, useState } from "react";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { useHydrated } from "remix-utils/use-hydrated";
import {
  ChevronRight,
  DuplicateIcon,
  LocationMarkerIcon,
  PenIcon,
  UserIcon,
  UserXIcon,
} from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import { tw } from "~/utils/tw-classes";
import { DeleteAsset } from "./delete-asset";
import { Button } from "../shared";

const ConditionalActionsDropdown = () => {
  const { asset } = useLoaderData<typeof loader>();
  const assetCanBeReleased = asset.custody;

  let [searchParams] = useSearchParams();
  const refIsQrScan = searchParams.get("ref") === "qr";
  const defaultOpen = window.innerWidth <= 640 && refIsQrScan;
  const [open, setOpen] = useState(defaultOpen);
  const [defaultApplied, setDefaultApplied] = useState(false);
  const assetIsCheckedOut = asset.status === "CHECKED_OUT";

  useEffect(() => {
    if (defaultOpen && !defaultApplied) {
      setOpen(true);
      setDefaultApplied(true);
    }
  }, [defaultOpen, defaultApplied]);

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
          className="asset-actions hidden sm:flex"
          onClick={() => setOpen(!open)}
        >
          <Button variant="secondary" data-test-id="assetActionsButton">
            <span className="flex items-center gap-2">
              Actions <ChevronRight className="chev" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu triggerer on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="secondary"
          data-test-id="assetActionsButton"
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
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]"
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            <DropdownMenuItem
              className="border-b p-4 md:mb-0 md:p-0"
              disabled={assetIsCheckedOut && !assetCanBeReleased}
            >
              {assetCanBeReleased ? (
                <Button
                  to="release-custody"
                  role="link"
                  variant="link"
                  className="justify-start whitespace-nowrap px-4 py-3  text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={() => setOpen(false)}
                >
                  <span className="flex items-center gap-1">
                    <UserXIcon /> Release Custody
                  </span>
                </Button>
              ) : (
                <Button
                  to="give-custody"
                  role="link"
                  variant="link"
                  className="justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={() => setOpen(false)}
                >
                  <span className="flex items-center gap-2">
                    <UserIcon /> Give Custody
                  </span>
                </Button>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={tw("mb-2.5 border-b p-4 md:mb-0 md:p-0")}
              disabled={assetIsCheckedOut}
            >
              <Button
                to="update-location"
                role="link"
                variant="link"
                className={tw(
                  "justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                )}
                width="full"
                onClick={() => setOpen(false)}
              >
                <span className="flex items-center gap-2">
                  <LocationMarkerIcon /> Update Location
                </span>
              </Button>
            </DropdownMenuItem>
            <DropdownMenuItem className="px-4 py-1 md:p-0">
              <Button
                to="edit"
                role="link"
                variant="link"
                className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                width="full"
              >
                <span className="flex items-center gap-2">
                  <PenIcon /> Edit
                </span>
              </Button>
            </DropdownMenuItem>
            <DropdownMenuItem className="px-4 py-1 md:p-0">
              <Button
                to="duplicate"
                role="link"
                variant="link"
                className="justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
                width="full"
              >
                <span
                  className="flex items-center gap-2"
                  onClick={() => setOpen(false)}
                >
                  <DuplicateIcon /> Duplicate
                </span>
              </Button>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
              disabled={assetIsCheckedOut}
            >
              <DeleteAsset asset={asset} />
            </DropdownMenuItem>
            <DropdownMenuItem className="mt-3 border-t p-4 md:hidden md:p-0">
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
            {assetIsCheckedOut ? (
              <div className=" border-t p-2 text-left text-xs">
                Some actions are disabled due to the asset being checked out.
              </div>
            ) : null}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

const ActionsDopdown = () => {
  const isHydrated = useHydrated();

  if (!isHydrated)
    return (
      <Button variant="secondary" to="#" data-test-id="assetActionsButton">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );

  return (
    <div className="actions-dropdown flex">
      <ConditionalActionsDropdown />
    </div>
  );
};

export default ActionsDopdown;
