import { useState } from "react";
import type { Asset } from "@prisma/client";
import { useSearchParams } from "@remix-run/react";
import { useHydrated } from "remix-utils";
import {
  ChevronRight,
  DuplicateIcon,
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
import { tw } from "~/utils/tw-classes";
import { DeleteAsset } from "./delete-asset";
import { Button } from "../shared";

interface Props {
  asset: {
    title: Asset["title"];
    mainImage: Asset["mainImage"];
    status: Asset["status"];
  };
}

const ConditionalActionsDropdown = ({ asset }: Props) => {
  const assetIsAvailable = asset.status === "AVAILABLE";
  let [searchParams] = useSearchParams();
  const refIsQrScan = searchParams.get("ref") === "qr";
  const defaultOpen = window.innerWidth <= 640 && refIsQrScan;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => setOpen(open)}
        open={open}
      >
        <DropdownMenuTrigger className="asset-actions">
          <Button variant="secondary" to="#" data-test-id="assetActionsButton">
            <span className="flex items-center gap-2">
              Actions <ChevronRight className="chev" />
            </span>
          </Button>
        </DropdownMenuTrigger>

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
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-lg bg-white p-0 text-right md:static md:w-[180px] md:rounded-lg"
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-lg bg-white p-0 text-right md:static md:w-[180px] md:rounded-lg">
            <DropdownMenuItem className="mb-2.5 border-b px-8 py-7 md:mb-0 md:p-3">
              {!assetIsAvailable ? (
                <Button
                  to="release-custody"
                  role="link"
                  variant="link"
                  className="justify-start whitespace-nowrap
                text-gray-700 hover:text-gray-700"
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
                  className="justify-start text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={() => setOpen(false)}
                >
                  <span className="flex items-center gap-2">
                    <UserIcon /> Give Custody
                  </span>
                </Button>
              )}
            </DropdownMenuItem>
            <DropdownMenuItem className="px-8 py-4 md:p-3">
              <Button
                to="edit"
                role="link"
                variant="link"
                className="justify-start text-gray-700 hover:text-gray-700"
                width="full"
              >
                <span className="flex items-center gap-2">
                  <PenIcon /> Edit
                </span>
              </Button>
            </DropdownMenuItem>
            <DropdownMenuItem className="p-3">
              <Button
                to="duplicate"
                role="link"
                variant="link"
                className="justify-start text-gray-700 hover:text-gray-700"
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
              className="px-8 py-4 md:p-3"
              onSelect={(e) => {
                e.preventDefault();
              }}
            >
              <DeleteAsset asset={asset} />
            </DropdownMenuItem>
            <DropdownMenuItem className="mt-3 border-t p-4 md:hidden md:p-3">
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
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* overlay on mobile */}
      <div
        className={tw(
          "fixed right-0 top-0 z-50 h-screen w-screen cursor-pointer bg-[#344054]/50 transition duration-300 ease-in-out md:hidden",
          open ? "visible" : "invisible opacity-0"
        )}
      ></div>
    </>
  );
};

const ActionsDopdown = ({ asset }: Props) => {
  const isHydrated = useHydrated();
  if (!isHydrated)
    return (
      <Button variant="secondary" to="#" data-test-id="assetActionsButton">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev" />
        </span>
      </Button>
    );
  return (
    <div className="actions-dropdown">
      <ConditionalActionsDropdown asset={asset} />
    </div>
  );
};

export default ActionsDopdown;
