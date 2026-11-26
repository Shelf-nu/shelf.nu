/**
 * Unsaved-changes guard for form screens.
 *
 * Stops the user leaving a form screen (back button, back swipe, a navigation
 * that removes the screen) and asks before their edits are thrown away. Used by
 * the new asset, new booking and edit booking screens, by the edit asset form
 * through `useFormValidation`, and by the booking scanner (which passes a
 * notice for held leaves and stops only a person's own back actions).
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
  /**
   * Shown when a stopped leave is held, so the user knows why nothing
   * happened. Without it a hold is silent.
   */
  holdNotice?: { title: string; message: string };
  /**
   * Navigation action types the guard stops (for example `GO_BACK`, `POP`).
   * Any other removal passes untouched, before `decide` runs, so a "hold"
   * applies only to these too. Without it every removal is stopped.
   */
  guardedActions?: readonly string[];
};

/**
 * Whether the guard stops a removal caused by this navigation action.
 *
 * @param action - the action from the `beforeRemove` event
 * @param guardedActions - the action types to stop, or undefined for all
 * @returns true when the guard should decide on this removal
 */
export function isGuardedRemoval(
  action: unknown,
  guardedActions: readonly string[] | undefined
): boolean {
  if (!guardedActions) return true;
  const type = (action as { type?: unknown } | null)?.type;
  return typeof type === "string" && guardedActions.includes(type);
}

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
  holdNotice,
  guardedActions,
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

  usePreventRemove(active && !leaving, ({ data, repeat }) => {
    const leave = () => {
      setLeaving(true);
      repeat();
    };
    if (!isGuardedRemoval(data?.action, guardedActions)) return leave();
    const decision = decide();
    if (decision === "leave") return leave();
    if (decision === "hold") {
      if (holdNotice) Alert.alert(holdNotice.title, holdNotice.message);
      return;
    }
    Alert.alert(title, message, [
      { text: "Keep Editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: leave },
    ]);
  });
}
