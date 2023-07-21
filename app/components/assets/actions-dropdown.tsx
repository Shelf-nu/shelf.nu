import type { Asset } from "@prisma/client";
import { useAtom } from "jotai";
import { ChevronRight } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
// eslint-disable-next-line import/no-cycle
import { isCustodianAssignedAtom } from "~/routes/_layout+/assets.$assetId";
import { DeleteAsset } from "./delete-asset";
import { Button } from "../shared";

interface Props {
  asset: {
    title: Asset["title"];
    mainImage: Asset["mainImage"];
  };
}

export const ActionsDopdown = ({ asset }: Props) => {
  const [isCustodianAssigned] = useAtom(isCustodianAssignedAtom);
  return (
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
        className="order w-[180px] rounded-md bg-white p-0 text-right "
      >
        <DropdownMenuItem className="border-b px-6 py-3">
          {isCustodianAssigned ? (
            <Button
              to="release-custody"
              role="link"
              variant="link"
              className="justify-start text-gray-700 hover:text-gray-700"
              width="full"
            >
              Release Custody
            </Button>
          ) : (
            <Button
              to="give-custody"
              role="link"
              variant="link"
              className="justify-start text-gray-700 hover:text-gray-700"
              width="full"
            >
              Give Custody
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
            Edit
          </Button>
        </DropdownMenuItem>
        <DeleteAsset asset={asset} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
