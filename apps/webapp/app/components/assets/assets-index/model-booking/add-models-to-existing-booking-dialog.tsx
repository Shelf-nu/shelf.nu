/**
 * Reserve units of the selected asset models on a booking that already exists.
 *
 * The model view's second booking path: pick a booking, say how many units of
 * each selected model to add, submit once. Every reservation in the batch
 * commits together or none of them does, so the user is never left working out
 * which half landed.
 *
 * **The write is additive.** A quantity typed here is ADDED to what the
 * booking already reserves of that model — three against a booking holding
 * five ends at eight. That is a surprise at the till unless the user can see
 * it before submitting, so once a booking is chosen each row states the
 * projected total against what is free in that booking's window. Before a
 * booking is chosen there is no window and no existing reservation to report,
 * and the rows say nothing rather than showing a number computed against no
 * window at all.
 *
 * Availability is a hint and never a gate: it is read outside the reservation
 * transaction and can be stale by the time the write runs. Submitting against
 * a stale hint produces the all-or-nothing error naming the short model, which
 * is the honest answer; disabling submit on the hint would replace it with a
 * dead control nobody can explain.
 *
 * @see {@link file://./model-quantity-rows.tsx} — the per-model rows
 * @see {@link file://./../../../../routes/api+/bookings.model-requests-bulk.ts} — the write
 * @see {@link file://./../../../../routes/api+/bookings.$bookingId.model-availability.ts} — the hint data
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Booking } from "@prisma/client";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useAtomValue } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import Input from "~/components/forms/input";
import { CheckIcon } from "~/components/icons/library";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import When from "~/components/when/when";
import useApiQuery from "~/hooks/use-api-query";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { modelReservationsField } from "~/modules/asset-model/model-reservations-schema";
import type { BookingModelAvailabilityRow } from "~/routes/api+/bookings.$bookingId.model-availability";
import { canEditModelReservations } from "~/utils/booking-model-requests";
import { getValidationErrors } from "~/utils/http";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { tw } from "~/utils/tw";
import type { ModelQuantityRow } from "./model-quantity-rows";
import { ModelQuantityRows } from "./model-quantity-rows";

/**
 * Submitted shape of the "add models to an existing booking" form.
 *
 * Models are posted as indexed form fields (`models[0].assetModelId`,
 * `models[0].quantity`, …), which `parseData` turns back into an array before
 * this schema sees it. `quantity` is coerced because a form field is always a
 * string, and it is units to ADD rather than a target — the service sums it
 * onto whatever the booking already reserves.
 *
 * Lives here rather than in the route so the dialog and the action validate
 * the same object: the route imports it, which is the direction that keeps the
 * server module out of the client bundle.
 */
export const addModelsToExistingBookingSchema = z.object({
  bookingId: z
    .string({ required_error: "Please select a booking." })
    .min(1, "Please select a booking."),
  models: modelReservationsField("Select at least one model to reserve."),
});

/**
 * Slim booking shape `/api/bookings/get-all` returns. Only what the picker
 * renders, so nobody reads a column the endpoint does not send.
 */
type PickerBooking = Pick<Booking, "id" | "name" | "status" | "from" | "to">;

/**
 * A selected model row, as the asset index's model view carries it.
 *
 * Declared as a parameter type rather than destructured inline because bulk
 * selection rows arrive as `ListItemData`, whose index signature types every
 * field access as `any`. Reading them through a typed shape is what makes a
 * renamed field a build error instead of a silently empty list.
 */
type SelectedModelItem = {
  id: string;
  assetModelId?: string | null;
  name?: string | null;
};

/**
 * The models a reservation can actually be written against.
 *
 * Two rows are dropped. The "No model" bucket is not a model, so there are no
 * units of it to reserve; and the select-all sentinel is a marker rather than
 * a row, with no model behind it to name.
 *
 * @param selected - The current bulk selection
 * @returns One entry per reservable model, in selection order
 */
function toSelectableModels(
  selected: SelectedModelItem[]
): { assetModelId: string; name: string }[] {
  return selected
    .filter(
      (item) => item.id !== ALL_SELECTED_KEY && Boolean(item.assetModelId)
    )
    .map((item) => ({
      assetModelId: item.assetModelId as string,
      name: item.name ?? "Unnamed model",
    }));
}

/**
 * Searchable picker for the booking the reservations land on.
 *
 * Offers only bookings whose reservations can still be changed, asked of
 * {@link canEditModelReservations} rather than spelled out here: the statuses
 * that accept a reservation are the service's rule, and a copy of the list
 * drifts the moment that rule moves.
 *
 * @param props.bookings - Every open booking the caller may write to
 * @param props.selectedId - The chosen booking, or `undefined`
 * @param props.onSelect - Reports the chosen booking
 * @param props.fieldName - `name` for the submitted hidden input
 * @param props.isLoading - Whether the bookings fetch is still in flight
 * @param props.disabled - Disables the trigger while the form submits
 * @param props.errorMessage - Validation message for the booking field
 */
function BookingSelect({
  bookings,
  selectedId,
  onSelect,
  fieldName,
  isLoading,
  disabled,
  errorMessage,
}: {
  bookings: PickerBooking[];
  selectedId?: string;
  onSelect: (bookingId: string | undefined) => void;
  fieldName: string;
  isLoading: boolean;
  disabled?: boolean;
  errorMessage?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const triggerRef = useRef<HTMLDivElement>(null);
  // Radix portals mount a frame late, which the hook accounts for.
  const searchInputRef = useAutoFocus<HTMLInputElement>({ when: isOpen });

  const filteredBookings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return bookings;
    return bookings.filter((booking) =>
      booking.name.toLowerCase().includes(query)
    );
  }, [bookings, searchQuery]);

  const selectedBooking = bookings.find((booking) => booking.id === selectedId);

  const triggerLabel = selectedBooking
    ? selectedBooking.name
    : isLoading
    ? "Fetching bookings..."
    : "Select a booking";

  return (
    <div className="relative z-50 mb-2">
      <input type="hidden" name={fieldName} value={selectedId ?? ""} />

      <Popover
        open={isOpen}
        onOpenChange={(open) => {
          // `disabled` on an `asChild` PopoverTrigger does not reliably block
          // opening (Radix clones the child), so gate the state change here.
          if (isLoading || disabled) return;
          setIsOpen(open);
        }}
      >
        <PopoverTrigger asChild disabled={isLoading || disabled}>
          <button
            type="button"
            className={tw(
              "w-full",
              (isLoading || disabled) && "cursor-not-allowed opacity-60"
            )}
          >
            <div
              ref={triggerRef}
              className="flex w-full items-center justify-between whitespace-nowrap rounded border border-gray-300 px-[14px] py-2 text-sm hover:cursor-pointer"
            >
              <span
                className={tw(
                  "truncate whitespace-nowrap pr-2",
                  !selectedBooking && "text-gray-500"
                )}
              >
                {triggerLabel}
              </span>
              <ChevronDownIcon />
            </div>
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[100] overflow-y-auto rounded-md border border-gray-300 bg-white"
            style={{ width: triggerRef.current?.clientWidth }}
            align="center"
            sideOffset={5}
          >
            <div className="flex items-center justify-between p-3">
              <div className="text-xs font-semibold text-gray-700">
                Existing bookings
              </div>
              <When truthy={Boolean(selectedBooking)}>
                <Button
                  type="button"
                  as="button"
                  variant="link"
                  className="whitespace-nowrap text-xs font-normal text-gray-500 hover:text-gray-600"
                  onClick={() => onSelect(undefined)}
                >
                  Clear selection
                </Button>
              </When>
            </div>

            <div className="filters-form relative border-y border-y-gray-200 p-3">
              <Input
                ref={searchInputRef}
                type="text"
                label="Search bookings"
                placeholder="Search bookings"
                hideLabel
                className="text-gray-500"
                icon="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
              />
            </div>

            <div
              className="max-h-[320px] divide-y overflow-y-auto"
              role="listbox"
              aria-label="Existing bookings"
            >
              {filteredBookings.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  {isLoading
                    ? "Fetching bookings..."
                    : searchQuery
                    ? "No bookings found"
                    : "No open bookings available"}
                </div>
              ) : (
                filteredBookings.map((booking) => (
                  <div
                    key={booking.id}
                    className={tw(
                      "flex cursor-pointer touch-manipulation select-none items-center justify-between gap-4 px-4 py-3 outline-none hover:bg-gray-100 focus:bg-gray-100",
                      booking.id === selectedId && "bg-gray-100"
                    )}
                    role="option"
                    aria-selected={booking.id === selectedId}
                    tabIndex={0}
                    onClick={() => {
                      onSelect(booking.id);
                      setIsOpen(false);
                    }}
                    onKeyDown={handleActivationKeyPress(() => {
                      onSelect(booking.id);
                      setIsOpen(false);
                    })}
                  >
                    <div className="flex min-w-0 flex-col items-start gap-1 text-black">
                      <div className="max-w-[250px] truncate font-medium">
                        {booking.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        <DateS date={booking.from} includeTime /> -{" "}
                        <DateS date={booking.to} includeTime />
                      </div>
                    </div>
                    <When truthy={booking.id === selectedId}>
                      <span className="h-auto w-[18px] shrink-0 text-primary">
                        <CheckIcon />
                      </span>
                    </When>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <When truthy={Boolean(errorMessage)}>
        <p className="mt-2 text-sm text-error-500">{errorMessage}</p>
      </When>
    </div>
  );
}

/**
 * Confirmation shown once a batch of reservations has landed.
 *
 * Exists because the booking is worth offering but not worth navigating to: a
 * user reserving the same models across several bookings would lose the
 * selection view they are working from. The link is the affordance; taking it
 * is their choice.
 *
 * @param props.booking - The booking the reservations landed on
 * @param props.onClose - Dismisses the confirmation
 */
function ReservationConfirmation({
  booking,
  onClose,
}: {
  booking: { id: string; name: string };
  onClose: () => void;
}) {
  return (
    <DialogPortal>
      <Dialog
        open
        onClose={onClose}
        className="lg:w-[420px]"
        title={
          <div className="w-full">
            <div className="mb-5">
              <h4>Models reserved</h4>
              <p>
                The units you chose are now reserved on{" "}
                <span className="font-medium text-gray-700">
                  {booking.name}
                </span>
                .
              </p>
            </div>
          </div>
        }
      >
        <div className="flex items-center gap-3 px-6 pb-6">
          <Button
            type="button"
            variant="secondary"
            width="full"
            onClick={onClose}
          >
            Stay here
          </Button>
          <Button
            to={`/bookings/${booking.id}`}
            variant="primary"
            width="full"
            onClick={onClose}
          >
            View booking
          </Button>
        </div>
      </Dialog>
    </DialogPortal>
  );
}

/**
 * The "add to existing booking" dialog for the asset index's model view.
 *
 * Rendered alongside its trigger, and driven by the shared bulk-dialog
 * chokepoint: on success the dialog closes and the selection clears, both of
 * which are the chokepoint's defaults. It deliberately takes NEITHER
 * `skipCloseOnSuccess` NOR `keepSelectionOnSuccess` — those two belong
 * together and only to a dialog that keeps an in-dialog success panel alive to
 * re-use the selection. This one has no such panel, and taking one of the pair
 * without the other leaves the dialog open over state it no longer owns.
 *
 * @returns The dialog, and the post-success confirmation that outlives it
 */
export default function AddModelsToExistingBookingDialog() {
  const zo = useZorm(
    "AddModelsToExistingBooking",
    addModelsToExistingBookingSchema
  );

  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const bulkDialogOpenState = useAtomValue(bulkDialogAtom);
  const isDialogOpen = bulkDialogOpenState["model-booking-exist"] === true;

  const [selectedBookingId, setSelectedBookingId] = useState<
    string | undefined
  >(undefined);
  /** Units to add, keyed by `assetModelId`. Absent means one. */
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  /** Models dropped inside the dialog, keyed by `assetModelId`. */
  const [removedModelIds, setRemovedModelIds] = useState<
    Record<string, boolean>
  >({});
  /** The booking of the last successful batch, offered as a link. */
  const [confirmation, setConfirmation] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Each opening starts from the current selection: quantities, removals and
  // the chosen booking all describe one batch and must not survive into the
  // next one.
  useEffect(
    function resetOnOpen() {
      if (!isDialogOpen) return;
      setSelectedBookingId(undefined);
      setQuantities({});
      setRemovedModelIds({});
    },
    [isDialogOpen]
  );

  const selectableModels = useMemo(
    () => toSelectableModels(selectedItems as SelectedModelItem[]),
    [selectedItems]
  );

  const modelsToReserve = useMemo(
    () =>
      selectableModels.filter((model) => !removedModelIds[model.assetModelId]),
    [selectableModels, removedModelIds]
  );

  const { data: bookingsData, isLoading: isFetchingBookings } = useApiQuery<{
    error: null;
    bookings: PickerBooking[];
  }>({
    api: "/api/bookings/get-all",
    enabled: isDialogOpen,
  });

  // Asked of the shared predicate rather than matched against a list spelled
  // out here: the statuses that still accept a reservation are the service's
  // rule, and a second copy of it drifts.
  const bookings = useMemo(
    () =>
      (bookingsData?.bookings ?? []).filter((booking) =>
        canEditModelReservations(booking.status)
      ),
    [bookingsData]
  );

  const availabilityParams = useMemo(() => {
    const params = new URLSearchParams();
    for (const model of modelsToReserve) {
      params.append("assetModelId", model.assetModelId);
    }
    return params;
  }, [modelsToReserve]);

  const { data: availabilityData } = useApiQuery<{
    error: { message: string } | null;
    bookingId?: string;
    models?: BookingModelAvailabilityRow[];
  }>({
    api: `/api/bookings/${selectedBookingId ?? ""}/model-availability`,
    searchParams: availabilityParams,
    enabled:
      isDialogOpen && Boolean(selectedBookingId) && modelsToReserve.length > 0,
  });

  /**
   * The hint rows, but only while they describe the booking now selected.
   *
   * The last answer survives in state while the next request is in flight, so
   * switching bookings would otherwise show one booking's reservations under
   * another's name. The response echoes its own `bookingId` precisely so that
   * can be checked; a mismatch leaves every row hintless, which says "not
   * known yet" rather than something untrue.
   */
  const availabilityByModel = useMemo(() => {
    if (!selectedBookingId || availabilityData?.bookingId !== selectedBookingId)
      return new Map<string, BookingModelAvailabilityRow>();

    return new Map(
      (availabilityData.models ?? []).map((row) => [row.assetModelId, row])
    );
  }, [availabilityData, selectedBookingId]);

  /**
   * The rows, carrying the hint fields only for models the endpoint answered
   * for.
   *
   * A model it has no row for keeps both fields undefined, which is the same
   * state the rows show before a booking is chosen: the quantity alone, with
   * no availability claimed. That is deliberate — an absent row means the
   * figure is unknown, not that nothing is reserved and everything is free.
   */
  const rows: ModelQuantityRow[] = useMemo(
    () =>
      modelsToReserve.map((model) => {
        const context = availabilityByModel.get(model.assetModelId);
        return {
          assetModelId: model.assetModelId,
          name: model.name,
          alreadyReserved: context?.alreadyReserved,
          available: context?.available,
        };
      }),
    [modelsToReserve, availabilityByModel]
  );

  const handleQuantityChange = useCallback(
    (assetModelId: string, quantity: number) => {
      setQuantities((prev) => ({ ...prev, [assetModelId]: quantity }));
    },
    []
  );

  const handleRemoveModel = useCallback((assetModelId: string) => {
    setRemovedModelIds((prev) => ({ ...prev, [assetModelId]: true }));
  }, []);

  const selectedBooking = bookings.find(
    (booking) => booking.id === selectedBookingId
  );
  /**
   * The chosen booking, readable from a callback that takes no arguments.
   *
   * Success is reported through `onSuccess`, which is called after the
   * chokepoint has already reset the fetcher — so the response carrying the
   * booking is gone by then, and the picker's own state is the only source
   * left. Mirrored during render rather than in an effect because the child's
   * effects run first: an effect here would still hold the previous commit's
   * value at the moment success is reported.
   */
  const selectedBookingRef = useRef(selectedBooking);
  selectedBookingRef.current = selectedBooking;

  const handleSuccess = useCallback(() => {
    const booking = selectedBookingRef.current;
    if (!booking) return;
    setConfirmation({ id: booking.id, name: booking.name });
  }, []);

  return (
    <>
      <BulkUpdateDialogContent
        ref={zo.ref}
        type="model-booking-exist"
        // The chokepoint submits the raw selection under this name; the
        // reservations themselves travel as `models[i]` below, because each
        // one carries a quantity that a bare list of ids cannot express. The
        // action ignores this field.
        arrayFieldId="selectedAssetModelIds"
        title="Add models to existing booking"
        description={`Reserve units of the selected (${modelsToReserve.length}) models on an existing booking.`}
        actionUrl="/api/bookings/model-requests-bulk"
        className="lg:w-[600px]"
        onSuccess={handleSuccess}
      >
        {({ disabled, handleCloseDialog, fetcherData, fetcherError }) => {
          // `disabled` comes from the chokepoint, which derives it from the
          // fetcher submitting this form. `useDisabled` watches navigation and
          // never sees a fetcher submission, so it would read as idle for the
          // whole write.

          /** Server-side fallback for when client validation is bypassed. */
          const validationErrors = getValidationErrors<
            typeof addModelsToExistingBookingSchema
          >(fetcherData?.error);

          return (
            <div className="max-h-[calc(100vh_-_200px)] overflow-auto">
              <BookingSelect
                bookings={bookings}
                selectedId={selectedBookingId}
                onSelect={setSelectedBookingId}
                fieldName={zo.fields.bookingId()}
                isLoading={isFetchingBookings}
                disabled={disabled}
                errorMessage={
                  validationErrors?.bookingId?.message ||
                  zo.errors.bookingId()?.message
                }
              />

              <p className="mb-4 mt-2 text-gray-500">
                Only bookings whose reservations can still be changed are
                listed. Reserved units are matched to real assets later, by
                scanning or assigning them on the booking.
              </p>

              {rows.map((row, index) => (
                <div key={row.assetModelId}>
                  <input
                    type="hidden"
                    name={zo.fields.models(index).assetModelId()}
                    value={row.assetModelId}
                  />
                  <input
                    type="hidden"
                    name={zo.fields.models(index).quantity()}
                    value={quantities[row.assetModelId] ?? 1}
                  />
                </div>
              ))}

              <ModelQuantityRows
                rows={rows}
                quantities={quantities}
                onChange={handleQuantityChange}
                onRemove={handleRemoveModel}
              />

              <When truthy={rows.length === 0}>
                <div className="mb-4 rounded-md border border-gray-300 bg-gray-25 p-2">
                  <p className="text-sm text-gray-600">
                    No models left to reserve. Close this dialog and select at
                    least one model.
                  </p>
                </div>
              </When>

              <When
                truthy={Boolean(
                  validationErrors?.models?.message ||
                    zo.errors.models()?.message
                )}
              >
                <p className="mt-2 text-sm text-error-500">
                  {validationErrors?.models?.message ||
                    zo.errors.models()?.message}
                </p>
              </When>

              <When truthy={Boolean(fetcherError)}>
                <div className="my-4 rounded-md border border-gray-300 bg-gray-25 p-2">
                  <p className="text-sm text-gray-600">{fetcherError}</p>
                </div>
              </When>

              <div className="mt-4 flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  width="full"
                  disabled={disabled}
                  onClick={handleCloseDialog}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  width="full"
                  disabled={disabled}
                >
                  {disabled ? "Reserving..." : "Reserve"}
                </Button>
              </div>
            </div>
          );
        }}
      </BulkUpdateDialogContent>

      {confirmation ? (
        <ReservationConfirmation
          booking={confirmation}
          onClose={() => setConfirmation(null)}
        />
      ) : null}
    </>
  );
}
