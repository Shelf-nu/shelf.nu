import { useState } from "react";
import type { Prisma } from "@prisma/client";
import { PencilIcon } from "lucide-react";
import { VerticalDotsIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import type { ASSET_REMINDER_INCLUDE_FIELDS } from "~/modules/asset-reminder/fields";
import DeleteReminder from "./delete-reminder";
import SetOrEditReminderDialog from "./set-or-edit-reminder-dialog";
import When from "../when/when";

type ActionsDropdownProps = {
  reminder: Prisma.AssetReminderGetPayload<{
    include: typeof ASSET_REMINDER_INCLUDE_FIELDS;
  }>;
};

export default function ActionsDropdown({ reminder }: ActionsDropdownProps) {
  const [isDropdownOpem, setIsDropdownOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const now = new Date();
  const isPending = now < new Date(reminder.alertDateTime);

  return (
    <DropdownMenu
      open={isDropdownOpem}
      onOpenChange={setIsDropdownOpen}
      modal={false}
    >
      <DropdownMenuTrigger className="px-2">
        <VerticalDotsIcon />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="order p-1.5   ">
        <When truthy={isPending}>
          <DropdownMenuItem asChild>
            <Button
              role="button"
              variant="link"
              className="cursor-pointer justify-start text-gray-700 hover:text-gray-700"
              width="full"
              onClick={() => {
                setIsDropdownOpen(false);
                setIsEditDialogOpen(true);
              }}
              aria-label="Edit Reminder"
            >
              <span className="flex items-center gap-2">
                <PencilIcon className="size-4" /> Edit
              </span>
            </Button>
          </DropdownMenuItem>
        </When>
        <DropdownMenuItem asChild>
          <DeleteReminder reminder={reminder} />
        </DropdownMenuItem>
      </DropdownMenuContent>

      <SetOrEditReminderDialog
        reminder={{
          id: reminder.id,
          name: reminder.name,
          message: reminder.message,
          alertDateTime: reminder.alertDateTime,
          teamMembers: reminder.teamMembers.map((tm) => tm.id),
        }}
        open={isEditDialogOpen}
        onClose={() => {
          setIsEditDialogOpen(false);
        }}
      />
    </DropdownMenu>
  );
}
