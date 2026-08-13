import type { Asset } from "@prisma/client";
import { useNavigation } from "react-router";
import { isFormProcessing } from "~/utils/form";
import type { KitRemovalBookingImpact } from "./booking-removal-notice";
import { BookingRemovalNotice } from "./booking-removal-notice";
import { Form } from "../custom-form";
import Icon from "../icons/icon";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

export default function RemoveAssetFromKit({
  asset,
  bookingImpact,
}: {
  asset: Pick<Asset, "id" | "title">;
  /**
   * Bookings holding this asset through this kit, split by what the removal
   * does to them: RESERVED ones lose their slice, ONGOING/OVERDUE ones keep it
   * flagged as removed from the kit. Both are named in the dialog before the
   * user confirms. Advisory — the removal is never blocked.
   */
  bookingImpact?: KitRemovalBookingImpact;
}) {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="link"
          className="justify-start rounded-sm px-2 py-1.5 text-sm font-medium text-gray-700 outline-none hover:bg-slate-100 hover:text-gray-700"
          width="full"
          icon="trash"
        >
          Remove
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <Icon icon="trash" />
            </span>
          </div>
          <AlertDialogTitle>Remove "{asset.title}" from kit</AlertDialogTitle>
          {/* The notice lives INSIDE the description (as a block-displayed
              span, so the markup stays valid inside Radix's <p>) — Radix wires
              the description into the dialog's `aria-describedby`, so it is
              announced on open rather than appearing silently. */}
          <AlertDialogDescription>
            Are you sure you want to remove this asset from the kit? Asset will
            lose any status that is inherited by the kit.
            <BookingRemovalNotice
              // `text-left` because AlertDialogHeader centres its text on
              // mobile; a centred warning block reads as decoration.
              className="mt-3 text-left"
              reserved={{
                bookings: bookingImpact?.reserved ?? [],
                assetCount: 1,
              }}
              checkedOut={{
                bookings: bookingImpact?.checkedOut ?? [],
                assetCount: 1,
              }}
            />
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </AlertDialogCancel>

            <Form method="post" action={`..`}>
              <input type="hidden" name="assetId" value={asset.id} />
              <Button
                type="submit"
                name="intent"
                value="removeAsset"
                disabled={disabled}
              >
                Remove
              </Button>
            </Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
