import { useState } from "react";
import type { User } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { useFetcher } from "react-router";
import type { UserFriendlyRoles } from "~/routes/_layout+/settings.team";
import { isFormProcessing } from "~/utils/form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "../forms/select";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";
import When from "../when/when";

const roleOptions: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.BASE]: "Base",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};

export function ChangeRoleDialog({
  userId,
  currentRole,
  isSSO,
  open,
  onOpenChange,
}: {
  userId: User["id"];
  currentRole: UserFriendlyRoles;
  isSSO: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);

  /** Find the current role's enum key from its display name */
  const currentRoleKey =
    Object.entries(roleOptions).find(([, v]) => v === currentRole)?.[0] ?? "";

  const [selectedRole, setSelectedRole] = useState(currentRoleKey);

  const isSameRole = selectedRole === currentRoleKey;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent aria-describedby="change-role-description">
        <AlertDialogHeader>
          <AlertDialogTitle>Change user role</AlertDialogTitle>
          <AlertDialogDescription id="change-role-description">
            Change this user's role in the workspace. This takes effect
            immediately.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fetcher.Form
          method="post"
          onSubmit={() => {
            onOpenChange(false);
          }}
        >
          <input type="hidden" name="intent" value="changeRole" />
          <input type="hidden" name="userId" value={userId} />

          <div className="py-3">
            <SelectGroup>
              <SelectLabel className="pl-0 font-medium">Role</SelectLabel>
              <Select
                name="role"
                defaultValue={currentRoleKey}
                onValueChange={setSelectedRole}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent
                  position="popper"
                  className="w-full min-w-[300px]"
                  align="start"
                >
                  <div className="max-h-[320px] overflow-auto">
                    {Object.entries(roleOptions).map(([k, v]) => (
                      <SelectItem value={k} key={k} className="p-2">
                        <span className="block text-sm lowercase text-gray-900 first-letter:uppercase">
                          {v}
                        </span>
                      </SelectItem>
                    ))}
                  </div>
                </SelectContent>
              </Select>
            </SelectGroup>

            <When truthy={isSSO}>
              <p className="mt-3 text-sm text-warning-600">
                This user is managed via SSO. Their role may be overwritten on
                the next SSO sync.
              </p>
            </When>
          </div>

          <AlertDialogFooter className="mt-2 flex items-center gap-2">
            <AlertDialogCancel asChild>
              <Button
                variant="secondary"
                className="flex-1"
                type="button"
                disabled={disabled}
              >
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button
              type="submit"
              className="flex-1"
              disabled={disabled || isSameRole}
            >
              Change role
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
