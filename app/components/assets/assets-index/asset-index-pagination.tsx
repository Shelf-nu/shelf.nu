import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import { AlertIcon, ChevronRight } from "~/components/icons/library";
import { useSidebar } from "~/components/layout/sidebar/sidebar";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
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
                  className={tw(
                    "h-[34px]",
                    modeIsSimple ? disabledButtonStyles : ""
                  )}
                  name="mode"
                  value="SIMPLE"
                >
                  Simple
                </Button>
                <SwitchToAdvancedMode
                  modeIsAdvanced={modeIsAdvanced}
                  disabledButtonStyles={disabledButtonStyles}
                  onConfirm={() => {
                    fetcher.submit(
                      {
                        mode: "ADVANCED",
                        intent: "changeMode",
                      },
                      {
                        method: "post",
                        action: "/api/asset-index-settings",
                      }
                    );
                  }}
                />
              </ButtonGroup>
            </fetcher.Form>
          </When>
        </div>
      </When>
    </div>
  );
}

export const SwitchToAdvancedMode = ({
  modeIsAdvanced,
  disabledButtonStyles,
  onConfirm,
}: {
  modeIsAdvanced: boolean;
  disabledButtonStyles: string;
  onConfirm: () => void;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="secondary"
          className={tw("h-[34px]", modeIsAdvanced ? disabledButtonStyles : "")}
        >
          Advanced (Beta)
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <span className="size-6">
                <AlertIcon />
              </span>
            </span>
          </div>
          <AlertDialogTitle>Advanced Mode (Beta)</AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 text-center text-gray-500 md:text-left">
            <p>
              You are about to switch to Advanced Mode. This feature is
              currently in beta and includes:
            </p>
            <ul className="list-inside list-disc text-left">
              <li>Advanced filtering capabilities</li>
              <li>Custom column management</li>
              <li>Enhanced sorting options</li>
              <li>Custom field support</li>
            </ul>
            <p>
              While we've thoroughly tested this feature, you may encounter
              occasional issues. Your feedback helps us improve! If you face any
              issues, please report them to our support team so we can resolve
              them asap.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              onClick={() => {
                onConfirm();
                setOpen(false);
              }}
            >
              I understand, continue
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
