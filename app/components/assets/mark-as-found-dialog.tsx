import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { EyeIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
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
import type { AssetPageActionData } from "~/routes/_layout+/assets.$assetId";

interface Props {
  assetTitle: string;
  trigger?: React.ReactNode;
}

export function MarkAsFoundDialog({ assetTitle, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<AssetPageActionData>();

  const disabled = useDisabled(fetcher);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(
    function closeOnSuccess() {
      if (
        fetcher?.data &&
        "success" in fetcher?.data &&
        fetcher?.data?.success
      ) {
        handleClose();
      }
    },
    [fetcher?.data, handleClose]
  );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        {trigger || (
          <Button
            variant="link"
            className="justify-start whitespace-nowrap px-4 py-3 text-gray-700 hover:text-gray-700"
            width="full"
            role="link"
          >
            <EyeIcon className="mr-2 mt-[-2px] inline size-5" />
            <span>Mark as found</span>
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark asset as found</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to mark <strong>{assetTitle}</strong> as
            found? This will change the asset status to available and it can be
            assigned to custody or added to bookings again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="secondary" disabled={disabled}>
              Cancel
            </Button>
          </AlertDialogCancel>
          <fetcher.Form method="post" onSubmit={() => setOpen(false)}>
            <input type="hidden" name="intent" value="mark-as-found" />
            <Button type="submit" variant="primary">
              Mark as found
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
