/**
 * Create-booking dialog for the asset index's model view.
 *
 * Takes the models selected on the model view, asks how many units of each to
 * reserve, and creates a booking holding those reservations. The booking's own
 * fields — name, dates, custodian, tags, description — mirror the asset
 * index's create-booking dialog, so the two paths validate identically.
 *
 * **Nothing concrete is booked.** Each row becomes a `BookingModelRequest`: a
 * promise of N units of a model, fulfilled later by scanning or assigning
 * actual assets. That is why no availability figure is shown here — the
 * booking window is being chosen in this same form, and a number computed
 * before the dates are set would be a confident wrong answer. The reservation
 * transaction is the guard, and it refuses the whole batch if any model's pool
 * is short.
 *
 * Selection handling is the shared `BulkUpdateDialogContent` default: no
 * `skipCloseOnSuccess`, no `keepSelectionOnSuccess`. The asset index's
 * add-to-existing dialog takes both to keep an "add more" success panel alive;
 * this dialog has no such panel, and the two props are independent — taking
 * one without the other leaves a dialog that cannot finish.
 *
 * @see {@link file://./model-quantity-rows.tsx} — the per-model quantity list
 * @see {@link file://./../../../../routes/api+/bookings.create-for-models.ts} — the endpoint this posts to
 */
import { Fragment, useReducer, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { CustodianField } from "~/components/booking/forms/fields/custodian";
import { DatesFields } from "~/components/booking/forms/fields/dates";
import { DescriptionField } from "~/components/booking/forms/fields/description";
import { NameField } from "~/components/booking/forms/fields/name";
import type { BookingFormSchemaType } from "~/components/booking/forms/forms-schema";
import { BookingFormSchema } from "~/components/booking/forms/forms-schema";
import { BulkUpdateDialogContent } from "~/components/bulk-update-dialog/bulk-update-dialog";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { TagsAutocomplete } from "~/components/tag/tags-autocomplete";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useFormatPrefs } from "~/hooks/use-format-prefs";
import { useUserData } from "~/hooks/use-user-data";
import { useWorkingHours } from "~/hooks/use-working-hours";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getBookingDefaultStartEndTimes } from "~/modules/working-hours/utils";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getValidationErrors } from "~/utils/http";
import { userCanViewSpecificCustody } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import type { ModelQuantityRow } from "./model-quantity-rows";
import { ModelQuantityRows } from "./model-quantity-rows";

/** Units a freshly selected model reserves until the user says otherwise. */
const DEFAULT_QUANTITY = 1;

/**
 * A row of the model view as the bulk selection carries it.
 *
 * Selected items are typed `{ id: string; [key: string]: any }`, so reading
 * fields off them inline types every access as `any` and a renamed loader
 * field would go unnoticed. Naming the shape here is what gives the compiler
 * something to check.
 *
 * `assetModelId` is nullable because the model view also renders a synthetic
 * "No model" bucket, and the select-all marker carries no model at all.
 */
type SelectedModelItem = {
  id: string;
  assetModelId?: string | null;
  name?: string | null;
};

/** The dialog's local state: what to reserve, and what the user dropped. */
type ModelSelectionState = {
  /** Units to reserve, keyed by `assetModelId`. Absent means one. */
  quantities: Record<string, number>;
  /** Models dropped from this dialog without changing the page selection. */
  removedModelIds: string[];
};

/** Transitions of {@link ModelSelectionState}. */
type ModelSelectionAction =
  | { type: "set_quantity"; assetModelId: string; quantity: number }
  | { type: "remove_model"; assetModelId: string }
  | { type: "reset" };

const INITIAL_SELECTION_STATE: ModelSelectionState = {
  quantities: {},
  removedModelIds: [],
};

/**
 * Applies one change to the dialog's model selection.
 *
 * Quantities and removals move together, so they live in one state: a new page
 * selection has to clear both at once, and clearing only one would leave a
 * quantity attached to a model that is no longer on the list.
 *
 * @param state - The current quantities and removals
 * @param action - The change to apply
 * @returns The next state
 */
function modelSelectionReducer(
  state: ModelSelectionState,
  action: ModelSelectionAction
): ModelSelectionState {
  switch (action.type) {
    case "set_quantity":
      return {
        ...state,
        quantities: {
          ...state.quantities,
          [action.assetModelId]: action.quantity,
        },
      };

    case "remove_model":
      return {
        ...state,
        removedModelIds: [...state.removedModelIds, action.assetModelId],
      };

    case "reset":
      // Quantities and removals describe ONE editing session on ONE list, so
      // they are dropped both when the list changes underneath and when the
      // dialog is opened again. Removing a row does not deselect it on the
      // page, so without the reopen case a model dropped here would stay
      // invisibly removed while its checkbox still showed it selected — and
      // the dialog would report nothing to book.
      return INITIAL_SELECTION_STATE;
  }
}

/**
 * The models the user actually selected, as quantity rows.
 *
 * Drops anything without an `assetModelId`: the "No model" bucket, which is
 * not a model and has no units to reserve, and the select-all marker, which is
 * not a row.
 *
 * @param items - The current bulk selection
 * @returns One row per real model, in selection order
 */
function toModelRows(items: SelectedModelItem[]): ModelQuantityRow[] {
  return items
    .filter((item) => Boolean(item.assetModelId))
    .map((item) => ({
      assetModelId: item.assetModelId as string,
      name: item.name ?? "Untitled model",
    }));
}

/**
 * The dialog behind the model view's "Book selection → New booking" entry.
 *
 * @returns The bulk dialog content for the `model-bookings` type
 */
export default function CreateBookingForModelsDialog() {
  const { currentOrganization, teamMembers, teamMembersForForm, tagsData } =
    useLoaderData<AssetIndexLoaderData>();
  const tagsSuggestions = tagsData.tags.map((tag) => ({
    label: tag.name,
    value: tag.id,
  }));

  const selectedItems = useAtomValue(selectedBulkItemsAtom);
  const selectedModelRows = toModelRows(selectedItems);

  const workingHoursData = useWorkingHours();
  const { workingHours } = workingHoursData;
  const bookingSettings = useBookingSettings();
  const { isBaseOrSelfService, roles, isAdministratorOrOwner } =
    useUserRoleHelper();
  // Client-side date validation reads the RESOLVED preference zone, the same
  // one the display and the server parse use.
  const prefs = useFormatPrefs();

  const zo = useZorm(
    "CreateBookingForModels",
    BookingFormSchema({
      prefs,
      action: "new",
      workingHours,
      bookingSettings,
      isAdminOrOwner: isAdministratorOrOwner,
    })
  );

  const { startDate: defaultStartDate, endDate: defaultEndDate } =
    getBookingDefaultStartEndTimes(
      workingHours,
      bookingSettings.bufferStartTime,
      isAdministratorOrOwner,
      prefs
    );
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);

  const user = useUserData();
  // BASE/SELF_SERVICE users get their own team member, which the picker is
  // locked to.
  const teamMembersToUse = teamMembersForForm || teamMembers;
  const defaultTeamMember = isBaseOrSelfService
    ? teamMembersToUse.find((tm) => tm.userId === user!.id)
    : undefined;

  const userCanSeeCustodian = userCanViewSpecificCustody({
    roles,
    custodianUserId: defaultTeamMember?.userId || null,
    organization: currentOrganization,
    currentUserId: user?.id,
  });

  // Re-sync endDate when the computed default changes (e.g. once working hours
  // or buffer settings load). Mirrors the prop during render via a ref instead
  // of through a useEffect.
  const prevDefaultEndDate = useRef(defaultEndDate);
  if (defaultEndDate && defaultEndDate !== prevDefaultEndDate.current) {
    prevDefaultEndDate.current = defaultEndDate;
    setEndDate(defaultEndDate);
  }

  const [selectionState, dispatch] = useReducer(
    modelSelectionReducer,
    INITIAL_SELECTION_STATE
  );

  // Same ref-during-render mirroring: the quantities and removals belong to
  // one list of models, so they reset when that list changes on the page
  // behind the dialog. Removing a row here does not touch the page selection,
  // so this cannot loop.
  const selectionKey = selectedModelRows
    .map((row) => row.assetModelId)
    .join(",");
  const prevSelectionKey = useRef(selectionKey);
  if (selectionKey !== prevSelectionKey.current) {
    prevSelectionKey.current = selectionKey;
    dispatch({ type: "reset" });
  }

  // This dialog is mounted by the dropdown and stays mounted while closed, so
  // its reducer outlives a close. Each opening therefore starts a fresh batch.
  const isDialogOpen = useAtomValue(bulkDialogAtom)["model-bookings"] === true;
  const prevIsDialogOpen = useRef(isDialogOpen);
  if (isDialogOpen !== prevIsDialogOpen.current) {
    prevIsDialogOpen.current = isDialogOpen;
    if (isDialogOpen) {
      dispatch({ type: "reset" });
    }
  }

  const removedModelIds = new Set(selectionState.removedModelIds);
  const rows = selectedModelRows.filter(
    (row) => !removedModelIds.has(row.assetModelId)
  );

  return (
    <BulkUpdateDialogContent
      ref={zo.ref}
      type="model-bookings"
      // The dialog emits one hidden input per selected item under this name.
      // The route ignores them: rows are removable here, so the authoritative
      // list is the `models[…]` fields rendered below, which reflect what the
      // user is actually looking at.
      arrayFieldId="selectedAssetModelIds"
      title="Create booking"
      description={`Create a new booking reserving units of the selected (${rows.length}) models`}
      actionUrl="/api/bookings/create-for-models"
      className="lg:w-[600px]"
      // No `allowBodyOverflow` despite the TagsAutocomplete below: this dialog
      // scrolls its own content in the `max-h`/`overflow-auto` wrapper, which
      // already clips the suggestion listbox before the dialog body ever could.
    >
      {({ disabled, handleCloseDialog, fetcherError, fetcherData }) => {
        /** This handles server side errors in case client side validation fails */
        const validationErrors = getValidationErrors<BookingFormSchemaType>(
          fetcherData?.error
        );

        return (
          <div className="max-h-[calc(100vh_-_200px)] overflow-auto">
            <Card className="m-0 mb-2">
              <NameField
                name={undefined}
                fieldName={zo.fields.name()}
                error={
                  validationErrors?.name?.message || zo.errors.name()?.message
                }
                disabled={disabled}
                onChange={() => {}}
              />
            </Card>
            <Card className="m-0 mb-2">
              <DatesFields
                startDate={startDate}
                startDateName={zo.fields.startDate()}
                startDateError={
                  validationErrors?.startDate?.message ||
                  zo.errors.startDate()?.message
                }
                setStartDate={setStartDate}
                endDate={endDate}
                endDateName={zo.fields.endDate()}
                endDateError={
                  validationErrors?.endDate?.message ||
                  zo.errors.endDate()?.message
                }
                setEndDate={setEndDate}
                disabled={disabled}
                isNewBooking
                workingHoursData={workingHoursData}
              />
            </Card>
            <Card className="m-0 mb-2">
              <CustodianField
                defaultTeamMember={defaultTeamMember}
                disabled={disabled || isBaseOrSelfService}
                userCanSeeCustodian={userCanSeeCustodian}
                isNewBooking
                error={
                  validationErrors?.custodian?.message ||
                  zo.errors.custodian()?.message
                }
              />
            </Card>

            <Card className="m-0 mb-2 overflow-visible">
              <TagsAutocomplete
                existingTags={[]}
                suggestions={tagsSuggestions}
                required={bookingSettings.tagsRequired}
                error={
                  validationErrors?.tags?.message || zo.errors.tags()?.message
                }
              />
            </Card>

            <Card className="m-0 mb-2">
              <DescriptionField
                description={undefined}
                fieldName={zo.fields.description()}
                disabled={disabled}
                error={
                  validationErrors?.description?.message ||
                  zo.errors.description()?.message
                }
              />
            </Card>

            <Card className="m-0 mb-2">
              <div className="mb-3">
                <span className="block text-sm font-medium text-gray-700">
                  Units to reserve
                </span>
                <p className="text-xs text-gray-500">
                  These units are promised to the booking. The assets that serve
                  them are chosen later, by scanning or assigning.
                </p>
              </div>

              {rows.length > 0 ? (
                <ModelQuantityRows
                  rows={rows}
                  quantities={selectionState.quantities}
                  onChange={(assetModelId, quantity) =>
                    dispatch({ type: "set_quantity", assetModelId, quantity })
                  }
                  onRemove={(assetModelId) =>
                    dispatch({ type: "remove_model", assetModelId })
                  }
                />
              ) : (
                <p className="text-sm text-gray-500">
                  No models left to book. Close this dialog and select at least
                  one model.
                </p>
              )}

              {/* The submitted list, in step with what the user can see: a row
                  dropped above is a model this booking never hears about. */}
              {rows.map((row, index) => (
                <Fragment key={row.assetModelId}>
                  <input
                    type="hidden"
                    name={`models[${index}].assetModelId`}
                    value={row.assetModelId}
                  />
                  <input
                    type="hidden"
                    name={`models[${index}].quantity`}
                    value={
                      selectionState.quantities[row.assetModelId] ??
                      DEFAULT_QUANTITY
                    }
                  />
                </Fragment>
              ))}
            </Card>

            {fetcherError && !validationErrors ? (
              <p className="mt-2 text-sm text-error-500">{fetcherError}</p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                width="full"
                disabled={disabled}
                onClick={handleCloseDialog}
              >
                Cancel
              </Button>
              {/* `disabled` is the dialog's own fetcher state — the same value
                  `useDisabled(fetcher)` computes — because the form belongs to
                  BulkUpdateDialogContent's fetcher, not to navigation. */}
              <Button
                type="submit"
                variant="primary"
                width="full"
                disabled={
                  disabled ||
                  (rows.length === 0
                    ? { reason: "Select at least one model to book." }
                    : false)
                }
              >
                Confirm
              </Button>
            </div>
          </div>
        );
      }}
    </BulkUpdateDialogContent>
  );
}
