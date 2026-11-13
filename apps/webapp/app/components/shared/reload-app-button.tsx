/**
 * Reload App Button
 *
 * The one control that reloads the app onto a newer build. It is shared by
 * the new-version prompt and by `LazyLoadBoundary` (a lazy chunk that can no
 * longer be fetched), so both offer the same action with the same warning.
 *
 * @see {@link file://./../layout/new-version-prompt.tsx}
 * @see {@link file://./../../atoms/unsaved-changes.ts}
 */
import { useAtomValue } from "jotai";
import { dirtyFormCountAtom } from "~/atoms/unsaved-changes";
import { tw } from "~/utils/tw";
import { Button } from "./button";

/** Props for `ReloadAppButton`. */
type ReloadAppButtonProps = {
  /** Extra classes for the wrapper around the button and its hint. */
  className?: string;
};

/**
 * Reloads the page when clicked, and only then: nothing in the app reloads
 * on its own.
 *
 * While a form that tracks its changes with `useUnsavedChanges` is dirty, it
 * shows a hint to save first, and that hook's `beforeunload` handler makes the
 * browser confirm the reload. Neither covers a form while its save is in
 * flight, nor a form that does not use the hook: reloading over those
 * discards what they hold.
 *
 * @param props - See `ReloadAppButtonProps`
 */
export function ReloadAppButton({ className }: ReloadAppButtonProps) {
  const dirtyFormCount = useAtomValue(dirtyFormCountAtom);

  return (
    <div className={tw("flex flex-col items-start gap-1", className)}>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => window.location.reload()}
      >
        Reload
      </Button>
      {dirtyFormCount > 0 ? (
        <p className="text-xs text-gray-600">
          Save your changes first. Reloading discards them.
        </p>
      ) : null}
    </div>
  );
}
