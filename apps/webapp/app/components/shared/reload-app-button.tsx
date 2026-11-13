/**
 * Reload App Button
 *
 * The one control that reloads the app onto a newer build, and the warning
 * that goes with it. Shared by the new-version prompt and by
 * `LazyLoadBoundary` (a lazy chunk that can no longer be fetched), so both
 * offer the same action with the same words.
 *
 * Nothing in the app reloads on its own: only a click on this button does.
 * While a form that tracks its changes with `useUnsavedChanges` is dirty, the
 * hint asks to save first, and that hook's `beforeunload` handler makes the
 * browser confirm the reload. Neither covers a form while its save is in
 * flight, nor a form that does not use the hook: reloading over those
 * discards what they hold.
 *
 * @see {@link file://./../layout/new-version-prompt.tsx}
 * @see {@link file://./../../atoms/unsaved-changes.ts}
 */
import { useAtomValue } from "jotai";
import { dirtyFormCountAtom } from "~/atoms/unsaved-changes";
import { tw } from "~/utils/tw";
import type { ButtonSize } from "./button";
import { Button } from "./button";

/** Shown while a tracked form holds unsaved changes. */
export const UNSAVED_CHANGES_RELOAD_HINT =
  "Save your changes first. Reloading discards them.";

/**
 * Whether any form that tracks its changes holds unsaved ones right now.
 *
 * @returns `true` while at least one `useUnsavedChanges` form is dirty
 */
export function useHasUnsavedForms(): boolean {
  return useAtomValue(dirtyFormCountAtom) > 0;
}

/** Props for `ReloadAppButton`. */
type ReloadAppButtonProps = {
  /** Button size; the inline prompt uses `xs`. Defaults to `sm`. */
  size?: ButtonSize;
  className?: string;
};

/**
 * Reloads the page when clicked, and only then.
 *
 * @param props - See `ReloadAppButtonProps`
 */
export function ReloadAppButton({
  size = "sm",
  className,
}: ReloadAppButtonProps) {
  return (
    <Button
      type="button"
      variant="primary"
      size={size}
      className={className}
      onClick={() => window.location.reload()}
    >
      Reload
    </Button>
  );
}

/**
 * The save-first warning, rendered only while a tracked form is dirty.
 *
 * @param props - Extra classes for the paragraph
 */
export function UnsavedChangesReloadHint({
  className,
}: {
  className?: string;
}) {
  const hasUnsavedForms = useHasUnsavedForms();
  if (!hasUnsavedForms) return null;
  return (
    <p className={tw("text-xs text-gray-600", className)}>
      {UNSAVED_CHANGES_RELOAD_HINT}
    </p>
  );
}
