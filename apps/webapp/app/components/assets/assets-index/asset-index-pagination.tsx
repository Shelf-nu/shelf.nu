import { useFetcher } from "react-router";
import { ChevronRight } from "~/components/icons/library";
import { useSidebar } from "~/components/layout/sidebar/sidebar";

import When from "~/components/when/when";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";

import { useViewportHeight } from "~/hooks/use-viewport-height";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
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
  const fetcher = useFetcher({ key: "asset-index-settings-mode" });
  const { isMd } = useViewportHeight();
  const { state } = useSidebar();

  const { modeIsSimple, modeIsAdvanced } = useAssetIndexViewState();
  const disabledButtonStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";

  function handleScrollToTop() {
    let target: Element | Window | null = document.querySelector(
      modeIsSimple ? "main" : ".list-table-wrapper"
    );

    if (!target) {
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
        "asset-index-pagination flex flex-col items-center justify-between border-t border-gray-200 bg-white transition-all delay-75 ease-in-out md:flex-row",
        isMd ? "fixed bottom-0 right-0 z-[12]" : "",
        state === "collapsed" ? "lg:left-[48px]" : "lg:left-[256px]"
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
            aria-label="Scroll to top"
            className="h-[34px]"
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
                handleScrollToTop();
              }}
            >
              <input type="hidden" name="intent" value="changeMode" />

              <ButtonGroup>
                <Button
                  variant="secondary"
                  className={tw(
                    "h-[34px]",
                    modeIsSimple ? disabledButtonStyles : ""
                  )}
                  name="mode"
                  value="SIMPLE"
                  aria-label="Switch to simple mode"
                >
                  Simple
                </Button>
                <Button
                  variant="secondary"
                  className={tw(
                    "h-[34px]",
                    modeIsAdvanced ? disabledButtonStyles : ""
                  )}
                  name="mode"
                  value="ADVANCED"
                  aria-label="Switch to advanced mode"
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
