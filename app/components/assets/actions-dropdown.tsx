import { useState } from "react";
import type { Asset } from "@prisma/client";
import {
  ChevronRight,
  TrashIcon,
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
import { DeleteAsset } from "./delete-asset";
import { Button } from "../shared";

interface Props {
  asset: {
    title: Asset["title"];
    mainImage: Asset["mainImage"];
    status: Asset["status"];
  };
  isQr: boolean;
}

const ActionsDopdown = ({ asset, isQr }: Props) => {
  const assetIsAvailable = asset.status === "AVAILABLE";
  const defaultOpen = window.innerWidth <= 640 && isQr;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <DropdownMenu modal={false} defaultOpen={open}>
      <DropdownMenuTrigger className="asset-actions">
        <Button variant="secondary" to="#" data-test-id="assetActionsButton">
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="order relative w-screen rounded-lg bg-white p-0 text-right md:static md:w-[180px]"
      >
        <DropdownMenuItem className="border-b px-6 py-3">
          {!assetIsAvailable ? (
            <Button
              to="release-custody"
              role="link"
              variant="link"
              className="justify-start text-gray-700 hover:text-gray-700"
              width="full"
            >
              <span className="flex items-center gap-2">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ActionsDopdown;
