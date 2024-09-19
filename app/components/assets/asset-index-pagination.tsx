import {
  useFetcher,
  useLoaderData,
  useRouteLoaderData,
} from "@remix-run/react";
import type { loader as layoutLoader } from "~/routes/_layout+/_layout";
import type { loader as AssetIndexLoader } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";
import { Pagination } from "../list/pagination";
import { Button } from "../shared/button";
import { ButtonGroup } from "../shared/button-group";

export function AssetIndexPagination() {
  let minimizedSidebar = useRouteLoaderData<typeof layoutLoader>(
    "routes/_layout+/_layout"
  )?.minimizedSidebar;
  const fetcher = useFetcher();

  const { settings } = useLoaderData<typeof AssetIndexLoader>();

  const mode = settings?.mode || "SIMPLE";
  const disabledButtonStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";

  function handleModeChange(event: React.FormEvent<HTMLButtonElement>) {
    event.preventDefault();
    const mode = (event.currentTarget as HTMLButtonElement).value;
    const formData = new FormData();
    formData.append("mode", mode);

    fetcher.submit(formData, {
      method: "POST",
      action: "/api/asset-index-settings",
    });
  }

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
          <Button
            variant="secondary"
            className={tw(mode === "SIMPLE" ? disabledButtonStyles : "")}
            name="mode"
            value="SIMPLE"
            onClick={handleModeChange}
          >
            Simple
          </Button>
          <Button
            variant="secondary"
            className={tw(mode === "ADVANCED" ? disabledButtonStyles : "")}
            name="mode"
            value="ADVANCED"
            onClick={handleModeChange}
          >
            Advanced
          </Button>
        </ButtonGroup>
      </div>
    </div>
  );
}
