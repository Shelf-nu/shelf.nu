import { useState } from "react";
import type { Asset } from "@prisma/client";
import { useSearchParams } from "@remix-run/react";
import { useHydrated } from "remix-utils";
import { ChevronRight, PenIcon, UserIcon, UserXIcon } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
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
    <DropdownMenu modal={true} defaultOpen={open}>
      <DropdownMenuTrigger className="asset-actions">
        <Button variant="secondary" to="#" data-test-id="assetActionsButton">
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        asChild
        align="end"
        className="order static w-screen rounded-lg bg-white p-0 text-right md:static md:w-[180px]"
      >
        <div className="order fixed bottom-0 left-0 w-screen rounded-lg bg-white p-0 text-right md:static md:w-[180px]">
          <DropdownMenuItem className="border-b px-6 py-3">
            {!assetIsAvailable ? (
              <Button
                to="release-custody"
                role="link"
                variant="link"
                className="justify-start whitespace-nowrap
                text-gray-700 hover:text-gray-700"
                width="full"
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
              >
                <span className="flex items-center gap-2">
                  <UserIcon /> Give Custody
                </span>
              </Button>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem className="px-6 py-3">
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
          <DeleteAsset asset={asset} />
          <DropdownMenuItem className="border-t px-6 py-3 md:hidden">
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
  return <ConditionalActionsDropdown asset={asset} />;
};

export default ActionsDopdown;
