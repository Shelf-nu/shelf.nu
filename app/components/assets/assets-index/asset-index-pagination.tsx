import { useFetcher, useRouteLoaderData } from "@remix-run/react";
import { ChevronRight } from "~/components/icons/library";
import When from "~/components/when/when";
import { useAssetIndexMode } from "~/hooks/use-asset-index-mode";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader as layoutLoader } from "~/routes/_layout+/_layout";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { Pagination } from "../../list/pagination";
import { Button } from "../../shared/button";
import { ButtonGroup } from "../../shared/button-group";

export function AssetIndexPagination() {
  const { roles } = useUserRoleHelper();
  let minimizedSidebar = useRouteLoaderData<typeof layoutLoader>(
    "routes/_layout+/_layout"
  )?.minimizedSidebar;
  const fetcher = useFetcher({ key: "asset-index-settings-mode" });
  const { isMd } = useViewportHeight();

  const { modeIsSimple, modeIsAdvanced } = useAssetIndexMode();
  const disabledButtonStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";

  function handleScrollToTop() {
    let target: Element | Window | null = document.querySelector(
      ".list-table-wrapper"
    );

    if (!modeIsAdvanced || !target) {
      target = window;
    }

    target.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  return (
    <div
      className={tw(
        isMd ? "fixed bottom-0 right-0 z-[12]" : "",
        "asset-index-pagination  flex flex-col items-center justify-between border-t border-gray-200 bg-white md:flex-row ",
        minimizedSidebar ? "lg:left-[82px]" : "lg:left-[312px]"
      )}
    >
      <Pagination className="px-4 py-[6px]" />

      {/* /** On render mode switcher on md+ */}
      <When truthy={isMd}>
        <div className="flex items-stretch gap-2 px-4 py-[6px]">
          <Button
            onClick={handleScrollToTop}
            variant="secondary"
            title="Scroll to top"
          >
            <ChevronRight className="chev -rotate-90" />
          </Button>

          <When
            truthy={userHasPermission({
              roles,
              entity: PermissionEntity.assetIndexSettings,
              action: PermissionAction.update,
            })}
          >
            <fetcher.Form
              method="post"
              action="/api/asset-index-settings"
              onSubmit={() => {
                window.scrollTo({
                  top: 0,
                  behavior: "smooth",
                });
              }}
            >
              <input type="hidden" name="intent" value="changeMode" />

              <ButtonGroup>
                <Button
                  variant="secondary"
                  className={tw(modeIsSimple ? disabledButtonStyles : "")}
                  name="mode"
                  value="SIMPLE"
                >
                  Simple
                </Button>
                <Button
                  variant="secondary"
                  className={tw(modeIsAdvanced ? disabledButtonStyles : "")}
                  name="mode"
                  value="ADVANCED"
                >
                  Advanced
                </Button>
              </ButtonGroup>
            </fetcher.Form>
          </When>
        </div>
      </When>
    </div>
  );
}
