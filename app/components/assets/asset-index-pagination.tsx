import { useRouteLoaderData } from "@remix-run/react";
import type { loader as layoutLoader } from "~/routes/_layout+/_layout";
import { tw } from "~/utils/tw";
import { Pagination } from "../list/pagination";
import { Button } from "../shared/button";
import { ButtonGroup } from "../shared/button-group";

export function AssetIndexPagination() {
  let minimizedSidebar = useRouteLoaderData<typeof layoutLoader>(
    "routes/_layout+/_layout"
  )?.minimizedSidebar;
  return (
    <div
      className={tw(
        "asset-index-pagination z-99 fixed bottom-0 right-0 flex items-center justify-between border-t border-gray-200 bg-white ",
        minimizedSidebar ? "lg:left-[82px]" : "lg:left-[312px]"
      )}
    >
      <Pagination className="px-4 py-[6px]" />
      <div className="px-4 py-[6px]">
        <ButtonGroup>
          <Button to=".." variant="secondary">
            Simple
          </Button>
          <Button to=".." variant="secondary">
            Advanced
          </Button>
        </ButtonGroup>
      </div>
    </div>
  );
}
