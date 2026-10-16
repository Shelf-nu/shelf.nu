/**
 * Unsaved Changes Bar
 *
 * The pill that appears on create and edit forms the moment something
 * differs from the loaded values: "Unsaved changes" with Discard and Save.
 * It also renders the "leave this page?" dialog when the user tries to
 * navigate away while the form is dirty.
 *
 * State comes from `useUnsavedChanges`; this component only renders it.
 *
 * @see {@link file://./../../hooks/use-unsaved-changes.ts}
 */
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { createPortal } from "react-dom";
import { useDisabled } from "~/hooks/use-disabled";
import {
  useUnsavedChanges,
  type UnsavedChangesState,
} from "~/hooks/use-unsaved-changes";
import { Button } from "../shared/button";
import UnsavedChangesAlert from "../unsaved-changes-alert";

type UnsavedChangesBarProps = {
  /** Current state from `useUnsavedChanges`. */
  state: UnsavedChangesState;
  /** Puts every field back to the loaded values. */
  onDiscard: () => void;
  /** Submits the form as its own Save button does. */
  onSave: () => void;
  /** Label of the Save button. Default "Save". */
  saveLabel?: string;
};

/**
 * Bounds of the page's scroll container, so the desktop bar centres over
 * the page content rather than over the viewport (which includes the
 * sidebar). Read as CSS variables by the fixed wrapper.
 */
function useContentBounds(active: boolean) {
  const [bounds, setBounds] = useState<{ left: number; width: number }>();

  useEffect(() => {
    if (!active) return;
    const main = document.querySelector("main");
    if (!main) return;
    const measure = () => {
      const rect = main.getBoundingClientRect();
      setBounds({ left: rect.left, width: main.clientWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [active]);

  return bounds;
}

/**
 * Renders the unsaved-changes pill while a form is dirty, and the leave
 * dialog while a navigation is blocked. Renders nothing on a clean form.
 *
 * Desktop: fixed near the top, centred over the page content. Mobile (below
 * `md`): fixed to the bottom, full width, above the safe-area inset.
 *
 * @param props - See {@link UnsavedChangesBarProps}
 */
export function UnsavedChangesBar({
  state,
  onDiscard,
  onSave,
  saveLabel = "Save",
}: UnsavedChangesBarProps) {
  const disabled = useDisabled();
  const visible = state.status !== "clean";
  const bounds = useContentBounds(visible);
  /** Only this form's own submission reads as saving; any navigation
   * (a picker reloading the page) still disables the buttons. */
  const isSaving = state.status === "submitting";
  /**
   * Set while "Leave page" runs. The secondary button also closes the
   * dialog, and that close must not cancel the navigation it just allowed.
   */
  const leavingRef = useRef(false);

  if (!visible || typeof document === "undefined") return null;

  return (
    <>
      {createPortal(
        <div
          role="region"
          aria-label="Unsaved changes"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[env(safe-area-inset-bottom)] md:bottom-auto md:left-[var(--unsaved-bar-left)] md:right-auto md:top-3 md:w-[var(--unsaved-bar-width)] md:pb-0"
          style={
            bounds
              ? ({
                  "--unsaved-bar-left": `${bounds.left}px`,
                  "--unsaved-bar-width": `${bounds.width}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <div className="motion-reduce:animate-none pointer-events-auto flex w-full items-center justify-between gap-4 bg-gray-900 px-4 py-3 text-white shadow-lg duration-200 animate-in fade-in slide-in-from-bottom-2 md:w-auto md:rounded-full md:py-2 md:pl-5 md:pr-2 md:slide-in-from-top-2">
            <span className="text-sm font-semibold">
              {isSaving ? "Saving..." : "Unsaved changes"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={onDiscard}
                disabled={disabled || isSaving}
              >
                Discard
              </Button>
              <Button
                type="button"
                variant="primary"
                size="xs"
                onClick={onSave}
                disabled={disabled || isSaving}
              >
                {isSaving ? "Saving..." : saveLabel}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
      <UnsavedChangesAlert
        open={state.status === "blocked"}
        onOpenChange={(open) => {
          if (open || leavingRef.current) return;
          if (state.status === "blocked") state.stay();
        }}
        title="Unsaved changes"
        cancelLabel="Leave page"
        confirmLabel="Stay"
        onCancel={() => {
          if (state.status !== "blocked") return;
          leavingRef.current = true;
          state.proceed();
        }}
        onYes={() => {
          if (state.status === "blocked") state.stay();
        }}
      >
        You have changes that are not saved. Leave this page and lose them?
      </UnsavedChangesAlert>
    </>
  );
}

type UnsavedChangesGuardProps = {
  /** The form whose submitted values are tracked. */
  formRef: RefObject<HTMLFormElement | null>;
  /** See `useUnsavedChanges`: a new truthy value re-takes the baseline. */
  savedToken?: unknown;
  /** Puts every field back to the loaded values (the form remounts). */
  onDiscard: () => void;
  /** Field names excluded from the comparison, on top of the defaults. */
  ignore?: string[];
  /** Button whose name/value the bar's Save must send, if any. */
  getSubmitter?: () => HTMLElement | null;
  /** Label of the Save button. Default "Save". */
  saveLabel?: string;
};

/**
 * Tracks a form with `useUnsavedChanges` and renders its bar.
 *
 * Mount it only where tracking applies, never with tracking switched off:
 * React Router honours only the most recently registered blocker, so a
 * mounted guard inside a dialog would override the page form's guard.
 *
 * @param props - See {@link UnsavedChangesGuardProps}
 */
export function UnsavedChangesGuard({
  formRef,
  savedToken,
  onDiscard,
  ignore,
  getSubmitter,
  saveLabel,
}: UnsavedChangesGuardProps) {
  const { state, discard, save } = useUnsavedChanges({
    formRef,
    savedToken,
    onDiscard,
    ignore,
  });
  return (
    <UnsavedChangesBar
      state={state}
      onDiscard={discard}
      onSave={() => save(getSubmitter?.())}
      saveLabel={saveLabel}
    />
  );
}
