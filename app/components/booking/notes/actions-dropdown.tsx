import { useFetcher, useParams } from "react-router";
import { TrashIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "~/components/shared/dropdown";
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
import { useDisabled } from "~/hooks/use-disabled";

export const BookingActionsDropdown = ({ noteId }: { noteId: string }) => {
  const fetcher = useFetcher();
  const params = useParams();
  const disabled = useDisabled(fetcher);

  return (
    <AlertDialog>
      <DropdownMenu>
        <DropdownMenuTrigger className="outline-none focus-visible:border-0">
          <span className="flex size-6 cursor-pointer items-center justify-center rounded-md p-1 text-gray-700 hover:bg-gray-50">
            <svg
              width="12"
              height="4"
              viewBox="0 0 12 4"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 0.5C5.17157 0.5 4.5 1.17157 4.5 2C4.5 2.82843 5.17157 3.5 6 3.5C6.82843 3.5 7.5 2.82843 7.5 2C7.5 1.17157 6.82843 0.5 6 0.5Z"
                fill="currentColor"
              />
              <path
                d="M1 0.5C0.171573 0.5 -0.5 1.17157 -0.5 2C-0.5 2.82843 0.171573 3.5 1 3.5C1.82843 3.5 2.5 2.82843 2.5 2C2.5 1.17157 1.82843 0.5 1 0.5Z"
                fill="currentColor"
              />
              <path
                d="M11 0.5C10.1716 0.5 9.5 1.17157 9.5 2C9.5 2.82843 10.1716 3.5 11 3.5C11.8284 3.5 12.5 2.82843 12.5 2C12.5 1.17157 11.8284 0.5 11 0.5Z"
                fill="currentColor"
              />
            </svg>
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="order w-[180px] rounded bg-white p-1.5 text-right"
        >
          <div className="relative flex  select-none items-center rounded text-left text-[13px] leading-none outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-gradient-to-br hover:bg-gray-100">
            <AlertDialogTrigger asChild>
              <DropdownMenuItem className="w-full cursor-pointer rounded  py-2 text-left text-sm text-gray-700 hover:bg-gray-50 hover:text-gray-700">
                <span className="flex items-center gap-2">
                  <TrashIcon />
                  Delete
                </span>
              </DropdownMenuItem>
            </AlertDialogTrigger>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Are you sure you want to delete this note?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently remove this note
            from our servers.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={disabled}>Cancel</AlertDialogCancel>
          <fetcher.Form
            action={`/bookings/${params.bookingId}/activity`}
            method="DELETE"
          >
            <input type="hidden" name="noteId" value={noteId} />
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={disabled}
            >
              Delete
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
