import { useCallback, useRef } from "react";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import z from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { isBookingEarlyCheckin } from "~/modules/booking/helpers";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId";
import CheckinDialog from "./checkin-dialog";
import { BulkUpdateDialogContent } from "../bulk-update-dialog/bulk-update-dialog";
import { Button } from "../shared/button";

export const BulkPartialCheckinSchema = z.object({
  assetIds: z
    .array(z.string())
    .min(1, "Please select at least one asset to check in."),
});

export default function BulkPartialCheckinDialog() {
  const zo = useZorm("BulkPartialCheckin", BulkPartialCheckinSchema);
  const totalSelectedItems = useAtomValue(selectedBulkItemsCountAtom);
  const selectedItems = useAtomValue(selectedBulkItemsAtom);

  // Create a mutable ref object for the portal container
  const formRef = useRef<{ current: HTMLFormElement | null }>({
    current: null,
  });

  const { booking } = useLoaderData<BookingPageLoaderData>();

  // Check if this would be a final check-in (all remaining CHECKED_OUT assets are being selected)
  const remainingCheckedOutAssets = booking.assets.filter(
    (asset) => asset.status === "CHECKED_OUT"
  );
  const isFinalCheckin =
    selectedItems.length === remainingCheckedOutAssets.length &&
    remainingCheckedOutAssets.length > 0;

  // Check if it's an early check-in (only relevant for final check-ins)
  const isEarlyCheckin = Boolean(
    isFinalCheckin && booking.to && isBookingEarlyCheckin(booking.to)
  );

  // Form ID for CheckinDialog to reference
  const formId = `bulk-partial-checkin-form-${booking.id}`;

  // Combined ref callback for both zo.ref and formRef
  const combinedRef = useCallback(
    (form: HTMLFormElement | null) => {
      zo.ref(form);
      formRef.current.current = form;
      // Set the form ID when available
      if (form && !form.id) {
        form.id = formId;
      }
    },
    [zo, formId]
  );

  return (
    <BulkUpdateDialogContent
      ref={combinedRef}
      type="partial-checkbox"
      title={`Check in selected items (${totalSelectedItems})`}
      arrayFieldId="assetIds"
      description={`The following items will be checked in and marked as Available:`}
      actionUrl={`/bookings/${booking.id}/checkin-assets`}
    >
      {({ fetcherError, disabled, handleCloseDialog }) => (
        <>
          {/* Hidden field to request JSON response */}
          <input type="hidden" name="returnJson" value="true" />

          {/* List of items being checked in */}
          <div className="mb-4 max-h-48 overflow-y-auto rounded border bg-gray-50 p-3">
            <ul className="list-inside list-disc pl-4">
              {selectedItems.map((item: any) => (
                <li key={item.id} className="py-2 text-sm">
                  <span className="font-medium">{item.title}</span>
                  {item.category && (
                    <span className="text-gray-500">
                      ({item.category.name})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {fetcherError ? (
            <p className="mb-4 text-sm text-error-500">{fetcherError}</p>
          ) : null}

          <div className="flex gap-3">
            <Button
              variant="secondary"
              width="full"
              disabled={disabled}
              onClick={handleCloseDialog}
            >
              Cancel
            </Button>

            {/* Submit button - conditional based on early check-in */}
            {isEarlyCheckin ? (
              <CheckinDialog
                booking={{
                  id: booking.id,
                  name: booking.name,
                  to: booking.to,
                  from: booking.from,
                }}
                label={`Check in ${totalSelectedItems} item${
                  totalSelectedItems !== 1 ? "s" : ""
                }`}
                variant="primary"
                disabled={disabled}
                formId={formId}
                portalContainer={formRef.current.current || undefined}
              />
            ) : (
              <Button
                type="submit"
                variant="primary"
                width="full"
                disabled={disabled}
              >
                Check in {totalSelectedItems} item
                {totalSelectedItems !== 1 ? "s" : ""}
              </Button>
            )}
          </div>
        </>
      )}
    </BulkUpdateDialogContent>
  );
}
