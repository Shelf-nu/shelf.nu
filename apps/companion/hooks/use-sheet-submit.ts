/**
 * React binding for {@link submitFromSheet}: supplies the lock, the error
 * alert and the success haptic, so a caller names only the request and how to
 * close its sheet.
 *
 * Each call to this hook owns one lock. Submits made through the function it
 * returns run one at a time; a second tap while one is in flight is ignored.
 *
 * @see {@link file://./../lib/sheet-submit.ts} the sequence, and why the sheet stays open
 */
import { useRef } from "react";
import { Alert } from "react-native";
import * as Haptics from "expo-haptics";
import { submitFromSheet, type SheetSubmit } from "@/lib/sheet-submit";

type UseSheetSubmitParams = {
  /** Reloads the record the sheets edit, once a change is accepted. */
  refresh: () => Promise<void>;
  /** The caller's in-flight flag, which its sheets read as `isSubmitting`. */
  setSubmitting: (submitting: boolean) => void;
};

/**
 * Submits a sheet's request, closing the sheet only once the server accepts
 * it.
 *
 * @param request - The mutation, e.g. `() => api.managePlacements(...)`.
 * @param closeSheet - Closes the sheet; runs only after the change is
 *   accepted, and before the refetch.
 * @returns True when the server accepted the change.
 */
export type SubmitFromSheet = (
  request: SheetSubmit["request"],
  closeSheet: () => void
) => Promise<boolean>;

/**
 * Returns the submit function for sheets that stay open until their change is
 * accepted.
 *
 * @param params - See {@link UseSheetSubmitParams}.
 * @returns The submit function; see {@link SubmitFromSheet}.
 */
export function useSheetSubmit({
  refresh,
  setSubmitting,
}: UseSheetSubmitParams): SubmitFromSheet {
  const lock = useRef(false);

  return (request, closeSheet) =>
    submitFromSheet({
      lock,
      request,
      onAccepted: () => {
        closeSheet();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      },
      refresh,
      setSubmitting,
      showError: (message) => Alert.alert("Error", message),
    });
}
