import type { KeyboardEvent } from "react";
import { useMemo, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useAtom } from "jotai";
import { Search } from "lucide-react";
import { ChevronRight } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import When from "~/components/when/when";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { scannerActionAtom } from "./action-atom";
import AssignCustodyDrawer from "./uses/assign-custody-drawer";

const ACTION_CONFIGS = [
  {
    id: "View asset",
    permissionEntity: PermissionEntity.asset,
    permissionAction: PermissionAction.read,
  },
  {
    id: "Assign custody",
    permissionEntity: PermissionEntity.asset,
    permissionAction: PermissionAction.custody,
  },
  {
    id: "Release custody",
    permissionEntity: PermissionEntity.asset,
    permissionAction: PermissionAction.custody,
  },
  {
    id: "Add to location",
    permissionEntity: PermissionEntity.asset,
    permissionAction: PermissionAction.update,
  },
] as const;

// Create a type from the array values
export type ActionType = (typeof ACTION_CONFIGS)[number]["id"];

export function ActionSwitcher() {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useAtom(scannerActionAtom);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isLoading = useDisabled();
  const { roles } = useUserRoleHelper();

  // Filter actions based on user permissions
  const availableActions = useMemo(
    () =>
      ACTION_CONFIGS.filter(({ permissionEntity, permissionAction }) =>
        userHasPermission({
          roles,
          entity: permissionEntity,
          action: permissionAction,
        })
      ).map((config) => config.id),
    [roles]
  );

  const filteredActions = useMemo(() => {
    if (!searchQuery) return availableActions;

    return availableActions.filter((action) =>
      action.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery, availableActions]);

  const handleSearch = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setSelectedIndex(0); // Reset selection when search changes
  };

  // Ensure selected item is visible in viewport
  const scrollToIndex = (index: number) => {
    setTimeout(() => {
      const selectedElement = document.getElementById(`action-option-${index}`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }, 0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = prev < filteredActions.length - 1 ? prev + 1 : prev;
          scrollToIndex(newIndex);
          return newIndex;
        });
        break;
      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = prev > 0 ? prev - 1 : prev;
          scrollToIndex(newIndex);
          return newIndex;
        });
        break;
      case "Enter":
        event.preventDefault();
        if (filteredActions[selectedIndex]) {
          changeAction(filteredActions[selectedIndex]);
        }
        break;
    }
  };

  function changeAction(newAction: ActionType) {
    setAction(newAction);
    setSelectedIndex(availableActions.indexOf(newAction));
    setOpen(false);
  }

  return (
    <div>
      <When truthy={action === "Assign custody"}>
        <AssignCustodyDrawer isLoading={isLoading} />
      </When>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            className={tw(
              "py-[7px] text-[12px] font-normal ",
              open ? "bg-gray-50" : ""
            )}
          >
            <ChevronRight className="ml-[2px] inline-block rotate-90" />
            <span className="ml-2">Action: {action.toLowerCase()}</span>
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            className={tw(
              "z-[999999] mt-2 max-h-[400px] overflow-y-scroll rounded-md border border-gray-200 bg-white"
            )}
          >
            <div className="flex items-center border-b">
              <Search className="ml-4 size-4 text-gray-500" />
              <input
                ref={searchInputRef}
                placeholder="Search action..."
                className="border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
                value={searchQuery}
                onChange={handleSearch}
                onKeyDown={handleKeyDown}
              />
            </div>
            {filteredActions.map((action, index) => (
              <div
                id={`action-option-${index}`}
                key={action + index}
                className={tw(
                  "px-4 py-2 text-[14px] text-gray-600 hover:cursor-pointer hover:bg-gray-50",
                  selectedIndex === index && [
                    "bg-gray-50",
                    // Add borders only when item is selected
                    "relative",
                    // Top border - exclude for first item
                    index !== 0 &&
                      "before:absolute before:inset-x-0 before:top-0 before:border-t before:border-gray-200",
                    // Bottom border - exclude for last item
                    index !== filteredActions.length - 1 &&
                      "after:absolute after:inset-x-0 after:bottom-0 after:border-b after:border-gray-200",
                  ]
                )}
                onClick={() => changeAction(action)}
              >
                <span className="font-medium">{action}</span>
                <span className="ml-2 font-normal text-gray-500">
                  {getActionScope(action)}
                </span>
              </div>
            ))}
            {filteredActions.length === 0 && (
              <div className="px-4 py-2 text-[14px] text-gray-500">
                No columns found
              </div>
            )}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}

/*
 * Returns the scope of the action
 */
function getActionScope(action: ActionType) {
  switch (action) {
    case "View asset":
      return "single";
    case "Assign custody":
    case "Release custody":
    case "Add to location":
      return "bulk";
  }
}
