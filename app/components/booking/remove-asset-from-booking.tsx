import type { Asset } from "@prisma/client";
import { Form } from "@remix-run/react";
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
import { TrashIcon } from "../icons";

export const RemoveAssetFromBooking = ({ asset }: { asset: Asset }) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button
        variant="link"
        data-test-id="deleteBookingButton"
        icon="trash"
        className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
        width="full"
      >
        Remove
      </Button>
    </AlertDialogTrigger>

    <AlertDialogContent>
      <AlertDialogHeader>
        <div className="mx-auto md:m-0">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
            <TrashIcon />
          </span>
        </div>
        <AlertDialogTitle>Remove "{asset.title}" from booking</AlertDialogTitle>
        <AlertDialogDescription>
          Are you sure you want to remove this asset from the booking?
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <div className="flex justify-center gap-2">
          <AlertDialogCancel asChild>
            <Button variant="secondary">Cancel</Button>
          </AlertDialogCancel>

          <Form method="post">
            <input type="hidden" name="assetId" value={asset.id} />
            <Button
              className="border-error-600 bg-error-600 hover:border-error-800 hover:bg-error-800"
              type="submit"
              data-test-id="confirmRemoveAssetBUtton"
              name="intent"
              value="removeAsset"
            >
              Remove
            </Button>
          </Form>
        </div>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
