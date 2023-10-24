import type { InviteStatuses, User } from "@prisma/client";
import { Form } from "@remix-run/react";
import {
  RefreshIcon,
  RemoveUserIcon,
  VerticalDotsIcon,
} from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import { Button } from "../shared";

// @TODO do we need the user here?
export function TeamUsersActionsDropdown({
  userId,
  inviteStatus,
}: {
  userId: User["id"] | null;
  inviteStatus: InviteStatuses;
}) {
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger className="outline-none focus-visible:border-0">
          <i className="inline-block px-3 py-0 text-gray-400 ">
            <VerticalDotsIcon />
          </i>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="order w-[180px] rounded-md bg-white p-[6px] text-right"
        >
          <Form method="post">
            {/* Only show resend button if the invite is not accepted */}
            {inviteStatus !== "ACCEPTED" ? (
              <DropdownMenuItem className="mb-2.5 p-4 md:mb-0 md:p-0">
                <Button
                  to="update-location"
                  role="link"
                  variant="link"
                  className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                  width="full"
                  name="intent"
                  value="resend"
                >
                  <span className="flex items-center gap-2">
                    <RefreshIcon /> Resend invite
                  </span>
                </Button>
              </DropdownMenuItem>
            ) : null}
            {inviteStatus === "ACCEPTED" ? (
              <>
                {/* // @TODO check this */}
                {/* // <DropdownMenuItem className="mb-2.5 p-4 md:mb-0 md:p-0" asChild> */}
                {userId ? (
                  <input type="hidden" name="userId" value={userId} />
                ) : null}
                <Button
                  type="submit"
                  variant="link"
                  className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                  width="full"
                  name="intent"
                  value="revoke"
                >
                  <span className="flex items-center gap-2">
                    <RemoveUserIcon /> Revoke access
                  </span>
                </Button>
              </>
            ) : // </DropdownMenuItem>
            null}
          </Form>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
