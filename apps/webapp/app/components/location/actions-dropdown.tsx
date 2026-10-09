import { useState } from "react";
import type { Location } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useHydrated } from "remix-utils/use-hydrated";
import { StartAuditFromContextDialog } from "~/components/audit/start-audit-from-context-dialog";
import Icon from "~/components/icons/icon";
import { ChevronRight } from "~/components/icons/library";
import When from "~/components/when/when";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { DeleteLocation } from "./delete-location";
import { Button } from "../shared/button";
import { MobileDropdownStyles } from "../shared/mobile-dropdown-styles";

/** Which entries of the location actions menu the current member may use. */
type LocationActionPermissions = {
  canCreateAudit: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

/**
 * Resolves the location menu entries from the member's roles, so each entry
 * renders only when its route would accept the member.
 *
 * @returns One flag per menu entry
 */
function useLocationActionPermissions(): LocationActionPermissions {
  const roles = useOrganizationRoles();
  return {
    canCreateAudit: userHasPermission({
      roles,
      entity: PermissionEntity.audit,
      action: PermissionAction.create,
    }),
    canEdit: userHasPermission({
      roles,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    }),
    canDelete: userHasPermission({
      roles,
      entity: PermissionEntity.location,
      action: PermissionAction.delete,
    }),
  };
}

interface Props {
  location: {
    name: Location["name"];
    id: Location["id"];
    childCount?: number;
  };
  /** Total number of assets at this location */
  assetCount: number;
  fullWidth?: boolean;
}

const ConditionalActionsDropdown = ({
  location,
  assetCount,
  fullWidth,
  permissions,
}: Props & { permissions: LocationActionPermissions }) => {
  const hasChildLocations = (location.childCount ?? 0) > 0;
  const { ref: popoverContentRef, open, setOpen } = useControlledDropdownMenu();
  const [isStartAuditOpen, setIsStartAuditOpen] = useState(false);

  function handleMenuClose() {
    setOpen(false);
  }

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50 transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            width={fullWidth ? "full" : "auto"}
            data-test-id="assetActionsButton"
            className={tw(
              "asset-actions hidden sm:flex",
              fullWidth ? "w-full" : ""
            )}
          >
            <span className="flex items-center gap-2">
              Actions <ChevronRight className="chev" />
            </span>
          </Button>
        </PopoverTrigger>

        {/* using custom trigger on mobile which only opens popover to avoid conflicts with overlay */}
        <Button
          type="button"
          variant="secondary"
          width={fullWidth ? "full" : "auto"}
          data-test-id="assetActionsButton"
          className={tw("asset-actions sm:hidden", fullWidth ? "w-full" : "")}
          onClick={() => setOpen(true)}
        >
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev" />
          </span>
        </Button>

        <MobileDropdownStyles open={open} />

        <PopoverPortal>
          <PopoverContent
            ref={popoverContentRef}
            tabIndex={-1}
            align="end"
            side="bottom"
            sideOffset={4}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              popoverContentRef.current?.focus();
            }}
            className="order actions-dropdown static z-[99] !mt-0 w-screen rounded-b-none rounded-t-[4px] border border-gray-300 bg-white p-0 text-right md:static md:mt-auto md:w-[180px] md:rounded-t-[4px]"
          >
            <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-full md:rounded-t-[4px]">
              {/* Start Audit - only visible to users with audit create permission */}
              <When truthy={permissions.canCreateAudit}>
                <div className="border-b px-0 py-1 md:p-0">
                  <Button
                    type="button"
                    variant="link"
                    className="w-full justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                    onClick={() => {
                      setIsStartAuditOpen(true);
                      handleMenuClose();
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <Icon icon="start-audit" /> Create audit
                    </span>
                  </Button>
                </div>
              </When>

              {/* Edit location */}
              <When truthy={permissions.canEdit}>
                <div className="border-b px-0 py-1 md:p-0">
                  <Button
                    to="edit"
                    icon="pen"
                    role="link"
                    variant="link"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                    onClick={handleMenuClose}
                  >
                    Edit
                  </Button>
                </div>
              </When>

              {/* Delete location */}
              <When truthy={permissions.canDelete}>
                <div className="border-b px-0 py-1 md:p-0">
                  <DeleteLocation
                    location={location}
                    trigger={
                      <Button
                        type="button"
                        variant="link"
                        data-test-id="deleteAssetButton"
                        icon="trash"
                        className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                        width="full"
                      >
                        Delete
                      </Button>
                    }
                  />
                </div>
              </When>

              <div className="border-t p-4 md:hidden md:p-0">
                <Button
                  type="button"
                  role="button"
                  variant="secondary"
                  className="flex items-center justify-center text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={handleMenuClose}
                >
                  Close
                </Button>
              </div>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <StartAuditFromContextDialog
        contextType="location"
        contextId={location.id}
        contextName={location.name}
        assetCount={assetCount}
        hasChildLocations={hasChildLocations}
        open={isStartAuditOpen}
        onClose={() => setIsStartAuditOpen(false)}
        showTrigger={false}
      />
    </>
  );
};

export const ActionsDropdown = ({ location, assetCount, fullWidth }: Props) => {
  const isHydrated = useHydrated();
  const permissions = useLocationActionPermissions();

  // A member with no entry to use gets no menu rather than an empty one.
  if (
    !permissions.canCreateAudit &&
    !permissions.canEdit &&
    !permissions.canDelete
  ) {
    return null;
  }

  if (!isHydrated) {
    return (
      <Button
        variant="secondary"
        to="#"
        width={fullWidth ? "full" : "auto"}
        data-test-id="assetActionsButton"
      >
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );
  }

  return (
    <div className={tw("actions-dropdown flex", fullWidth ? "w-full" : "")}>
      <ConditionalActionsDropdown
        location={location}
        assetCount={assetCount}
        fullWidth={fullWidth}
        permissions={permissions}
      />
    </div>
  );
};
