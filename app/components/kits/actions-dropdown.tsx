import type { Prisma } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useHydrated } from "remix-utils/use-hydrated";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader } from "~/routes/_layout+/kits.$kitId";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import DeleteKit from "./delete-kit";
import Icon from "../icons/icon";
import { ChevronRight } from "../icons/library";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";
import When from "../when/when";

export default function ActionsDropdown({
  fullWidth,
}: {
  fullWidth?: boolean;
}) {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return (
      <Button variant="secondary" to="#" className={fullWidth && "w-full"}>
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );
  }

  return (
    <div className={tw("actions-dropdown flex", fullWidth && "w-full")}>
      <ConditionalActionsDropdown fullWidth={fullWidth} />
    </div>
  );
}

function ConditionalActionsDropdown({ fullWidth }: { fullWidth?: boolean }) {
  const { kit } = useLoaderData<typeof loader>();
  const kitCanBeReleased = kit.custody;
  const kitIsCheckedOut = kit.status === "CHECKED_OUT";

  const kitCustody = kit.custody as unknown as Prisma.KitCustodyGetPayload<{
    select: { custodian: { select: { userId: true } } };
  }>;

  const someAssetIsNotAvailable = kit.assets.some(
    (asset) => asset.status !== "AVAILABLE"
  );

  const { roles, isSelfService } = useUserRoleHelper();
  const user = useUserData();

  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  const disableReleaseForSelfService =
    isSelfService && kitCustody?.custodian?.userId !== user?.id;

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50  transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}

      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (defaultApplied && window.innerWidth <= 640) setOpen(open);
        }}
        open={open}
        defaultOpen={defaultOpen}
      >
        <DropdownMenuTrigger
          className={tw(
            "actions-dropdown hidden sm:flex",
            fullWidth ? "w-full" : ""
          )}
          onClick={() => setOpen(!open)}
          asChild
        >
          <Button variant="secondary" aria-label="Actions Trigger">
            <span className="flex items-center gap-2">
              Actions <ChevronRight className="chev" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu trigger on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="secondary"
          className="actions-dropdown sm:hidden"
          width="full"
          onClick={() => setOpen(true)}
          aria-label="Actions Trigger"
        >
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev" />
          </span>
        </Button>

        {open && (
          <style
            dangerouslySetInnerHTML={{
              __html: `@media (max-width: 640px) {
                [data-radix-popper-content-wrapper] {
                  transform: none !important;
                  will-change: auto !important;
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
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-surface p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-surface p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            <When
              truthy={userHasPermission({
                roles,
                entity: PermissionEntity.kit,
                action: PermissionAction.custody,
              })}
            >
              <DropdownMenuItem className="border-b  px-4 py-1 md:p-0">
                {kitCanBeReleased ? (
                  <Button
                    to="assets/release-custody"
                    role="link"
                    variant="link"
                    className="justify-start whitespace-nowrap px-4 py-3  text-color-700 hover:text-color-700"
                    width="full"
                    onClick={() => setOpen(false)}
                    disabled={disableReleaseForSelfService}
                    aria-label="Release Custody"
                  >
                    <span className="flex items-center gap-1">
                      <Icon icon="release-custody" /> Release custody
                    </span>
                  </Button>
                ) : (
                  <Button
                    to="assets/assign-custody"
                    role="link"
                    variant="link"
                    className="justify-start px-4 py-3 text-color-700 hover:text-color-700"
                    width="full"
                    onClick={() => setOpen(false)}
                    disabled={someAssetIsNotAvailable}
                    aria-label="Assign/Take Custody"
                  >
                    <span className="flex items-center gap-2">
                      <Icon icon="assign-custody" />{" "}
                      {isSelfService ? "Take" : "Assign"} custody
                    </span>
                  </Button>
                )}
              </DropdownMenuItem>
            </When>

            <When
              truthy={userHasPermission({
                roles,
                entity: PermissionEntity.kit,
                action: PermissionAction.update,
              })}
            >
              <DropdownMenuItem className="px-4 py-1 md:p-0">
                <Button
                  to="edit"
                  role="link"
                  variant="link"
                  className="justify-start px-4 py-3  text-color-700 hover:text-color-700"
                  width="full"
                >
                  <span className="flex items-center gap-2">
                    <Icon icon="pen" /> Edit
                  </span>
                </Button>
              </DropdownMenuItem>

              <DropdownMenuItem
                className="px-4 py-1 md:p-0"
                onSelect={(e) => {
                  e.preventDefault();
                }}
                disabled={kitIsCheckedOut || someAssetIsNotAvailable}
              >
                <DeleteKit kit={kit} />
              </DropdownMenuItem>
            </When>

            <When truthy={!isSelfService}>
              {kitIsCheckedOut || someAssetIsNotAvailable ? (
                <div className=" border-t p-2 text-left text-xs">
                  Some actions are disabled due to asset(s) not being Available.
                </div>
              ) : null}
            </When>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
