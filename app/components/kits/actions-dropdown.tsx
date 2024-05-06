import { useEffect, useState } from "react";
import { useLoaderData, useSearchParams } from "@remix-run/react";
import { useHydrated } from "remix-utils/use-hydrated";
import type { loader } from "~/routes/_layout+/kits.$kitId";
import { tw } from "~/utils/tw";
import { useControlledDropdownMenu } from "~/utils/use-controlled-dropdown-menu";
import DeleteKit from "./delete-kit";
import Icon from "../icons/icon";
import { ChevronRight, UserXIcon } from "../icons/library";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";

export default function ActionsDropdown() {
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
      <ConditionalActionsDropdown />
    </div>
  );
}

function ConditionalActionsDropdown() {
  const { kit } = useLoaderData<typeof loader>();
  const kitCanBeReleased = kit.custody;
  const [searchParams] = useSearchParams();
  const refIsQrScan = searchParams.get("ref") === "qr";
  const [defaultApplied, setDefaultApplied] = useState(false);
  const kitIsCheckedOut = kit.status === "CHECKED_OUT";

  const defaultOpen = window.innerWidth <= 640 && refIsQrScan;

  const someAssetIsNotAvailable = kit.assets.some(
    (asset) => asset.status !== "AVAILABLE"
  );

  const [dropdownRef, open, setOpen] = useControlledDropdownMenu(defaultOpen);

  useEffect(() => {
    if (defaultOpen && !defaultApplied) {
      setOpen(true);
      setDefaultApplied(true);
    }
  }, [defaultApplied, defaultOpen, setOpen]);

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
          asChild
        >
          <Button variant="secondary">Actions</Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu trigger on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="secondary"
          className="sm:hidden"
          onClick={() => setOpen(true)}
        >
          Actions
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
          className="order actions-dropdown static w-screen rounded-b-none rounded-t bg-white p-0 text-right"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            <DropdownMenuItem className="border-b  px-4 py-1 md:p-0">
              {kitCanBeReleased ? (
                <Button
                  to="release-custody"
                  role="link"
                  variant="link"
                  className={tw(
                    "justify-start whitespace-nowrap px-4 py-3  text-gray-700 hover:text-gray-700",
                    someAssetIsNotAvailable && "pointer-events-none opacity-50"
                  )}
                  width="full"
                  onClick={() => setOpen(false)}
                  disabled={someAssetIsNotAvailable}
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
                  className={tw(
                    "justify-start px-4 py-3  text-gray-700 hover:text-gray-700",
                    someAssetIsNotAvailable && "pointer-events-none opacity-50"
                  )}
                  width="full"
                  onClick={() => setOpen(false)}
                  disabled={someAssetIsNotAvailable}
                >
                  <span className="flex items-center gap-2">
                    <Icon icon="user" /> Assign custody
                  </span>
                </Button>
              )}
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
                  <Icon icon="pen" /> Edit
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
                  <Icon icon="duplicate" /> Duplicate
                </span>
              </Button>
            </DropdownMenuItem>

            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
              disabled={kitIsCheckedOut}
            >
              <DeleteKit kit={kit} />
            </DropdownMenuItem>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
