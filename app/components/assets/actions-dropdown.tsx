import type { Asset } from "@prisma/client";

import { ChevronRight } from "~/components/icons";
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
  };
}

export const ActionsDopdown = ({ asset }: Props) => (
  <DropdownMenu modal={false}>
    <DropdownMenuTrigger className="asset-actions">
      <Button variant="secondary" to="#" data-test-id="assetActionsButton">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev" />
        </span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      className="order w-[180px] rounded-md bg-white p-1.5 text-right "
    >
      <DropdownMenuItem>
        <Button
          to="edit"
          icon="pen"
          role="link"
          variant="link"
          className="justify-start text-gray-700 hover:text-gray-700"
          width="full"
        >
          Edit
        </Button>
      </DropdownMenuItem>
      <DeleteAsset asset={asset} />
    </DropdownMenuContent>
  </DropdownMenu>
);
