/**
 * The edit asset form's leave guard, as a pure decision.
 *
 * `useFormValidation` feeds this to `usePreventRemove`: `hold` says whether
 * leaving the screen is stopped at all, `prompt` whether the stopped leave
 * asks "Discard Changes?". Kept free of React so it runs under the node test
 * runner.
 *
 * @see {@link file://./../hooks/use-form-validation.ts} the only consumer
 */

/** What the guard does with an attempt to leave the form. */
export type LeaveGuard = {
  /** Leaving is stopped (passed to `usePreventRemove`). */
  hold: boolean;
  /** A stopped leave asks "Discard Changes?"; otherwise it is ignored. */
  prompt: boolean;
};

/**
 * Decides how the edit form treats an attempt to leave.
 *
 * - A save in flight: hold without asking, dirty or not. The save's success
 *   alert navigates once it answers, and an error keeps the user on the form;
 *   letting the screen go first would make that alert pop a second screen.
 * - Clean form, or a save the server accepted: leave freely. After a save the
 *   form still differs from the asset as first loaded, so dirtiness alone
 *   cannot release the guard.
 * - Dirty form otherwise: ask before discarding.
 *
 * @param args.isDirty - The form differs from the asset as loaded
 * @param args.didSave - The server accepted a save from this form
 * @param args.isSubmitting - A save request is in flight
 * @returns The guard's behavior
 */
export function editLeaveGuard({
  isDirty,
  didSave,
  isSubmitting,
}: {
  isDirty: boolean;
  didSave: boolean;
  isSubmitting: boolean;
}): LeaveGuard {
  const unsaved = isDirty && !didSave;
  return { hold: isSubmitting || unsaved, prompt: unsaved && !isSubmitting };
}
