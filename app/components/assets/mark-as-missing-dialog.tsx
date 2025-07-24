import { useCallback, useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { EyeOffIcon } from "lucide-react";
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

export function MarkAsMissingDialog({ assetTitle, trigger }: Props) {
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
            className="justify-start whitespace-nowrap px-4 py-3 text-gray-700 hover:text-gray-700"
            width="full"
            variant="link"
            role="link"
          >
            <EyeOffIcon className="mr-2 mt-[-2px] inline size-4" />
            <span>Mark as missing</span>
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark asset as missing</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to mark <strong>{assetTitle}</strong> as
            missing? This will prevent the asset from being assigned to custody
            or added to bookings until it is found.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            <Button variant="secondary" disabled={disabled}>
              Cancel
            </Button>
          </AlertDialogCancel>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="mark-as-missing" />
            <Button type="submit" variant="primary" disabled={disabled}>
              Mark as missing
            </Button>
          </fetcher.Form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
