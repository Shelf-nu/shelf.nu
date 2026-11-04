/**
 * Unsaved-changes guard for form screens.
 *
 * Stops the user leaving a form screen (back button, back swipe, a navigation
 * that removes the screen) and asks before their edits are thrown away. Used by
 * the new asset, new booking and edit booking screens, and by the edit asset
 * form through `useFormValidation`.
 *
 * @see {@link file://./use-form-validation.ts} the edit asset form's guard
 * @see {@link file://./../lib/edit-leave-guard.ts} the edit asset decision rules
 */
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect, usePreventRemove } from "expo-router";

/**
 * What a stopped leave does: go through, ask "Discard?", or keep the user on
 * the screen without asking.
 */
export type LeaveDecision = "leave" | "prompt" | "hold";

/** Options for {@link useDiscardGuard}. */
type DiscardGuardOptions = {
  /** Leaving the screen is stopped while this is true. */
  active: boolean;
  /**
   * Decides what a stopped leave does. Called when the user tries to leave,
   * so it may read refs (for example "the form was just submitted").
   */
  decide: () => LeaveDecision;
  /** Title of the "Discard?" alert. */
  title: string;
  /** Body of the "Discard?" alert. */
  message: string;
};

/**
 * Guards a form screen against losing unsaved edits.
 *
 * Leaving goes through `repeat()`, which lifts `usePreventRemove`'s block and
 * replays the navigation the user started. `leaving` drops `active` in the
 * same render, so the hook's own state and its `preventRemove` argument agree.
 * `leaving` resets when the screen gains focus and whenever `active` changes:
 * a replayed navigation that leaves the screen mounted must not switch the
 * guard off for the rest of the screen's life.
 *
 * @param options - When to guard, what a stopped leave does, and the alert copy
 */
export function useDiscardGuard({
  active,
  decide,
  title,
  message,
}: DiscardGuardOptions): void {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    setLeaving(false);
  }, [active]);

  useFocusEffect(
    useCallback(() => {
      setLeaving(false);
    }, [])
  );

  usePreventRemove(active && !leaving, ({ repeat }) => {
    const leave = () => {
      setLeaving(true);
      repeat();
    };
    const decision = decide();
    if (decision === "leave") return leave();
    if (decision === "hold") return;
    Alert.alert(title, message, [
      { text: "Keep Editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: leave },
    ]);
  });
}
