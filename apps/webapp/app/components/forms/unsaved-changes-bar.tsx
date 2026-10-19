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
  /** Disables Save while the form's own Save cannot run yet. */
  saveDisabled?: boolean;
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

/** Gap kept between the end of the page content and the bar, in px. */
const BAR_CLEARANCE_PX = 16;

/**
 * Grows the page scroll container's bottom padding while the bar floats at
 * the bottom of the viewport, so the form's last row can scroll out from
 * under it. When the bar sits at the top (`xl`) nothing changes.
 *
 * @param active - True while the bar is shown
 * @param barRef - The bar's visible pill
 */
function useReservedBottomSpace(
  active: boolean,
  barRef: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    const main = document.querySelector("main");
    const bar = barRef.current;
    if (!active || !main || !bar) return;
    const original = main.style.paddingBottom;
    const reserve = () => {
      const { top } = bar.getBoundingClientRect();
      const atBottom = top > window.innerHeight / 2;
      main.style.paddingBottom = atBottom
        ? `${window.innerHeight - top + BAR_CLEARANCE_PX}px`
        : original;
    };
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(bar);
    window.addEventListener("resize", reserve);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reserve);
      main.style.paddingBottom = original;
    };
  }, [active, barRef]);
}

/**
 * Renders the unsaved-changes pill while a form is dirty, and the leave
 * dialog while a navigation is blocked. Renders nothing on a clean form.
 *
 * A dark surface so it stands out from the page. Wide screens (`xl`): fixed near the
 * top, centred over the page content. Below `xl` the breadcrumb row is too
 * narrow to share with the form's header actions, so from `md` it floats at
 * the bottom instead. Below `md`: a full-width strip at the bottom, above
 * the safe-area inset.
 *
 * @param props - See {@link UnsavedChangesBarProps}
 */
export function UnsavedChangesBar({
  state,
  onDiscard,
  onSave,
  saveLabel = "Save",
  saveDisabled = false,
}: UnsavedChangesBarProps) {
  const disabled = useDisabled();
  const visible = state.status !== "clean";
  const bounds = useContentBounds(visible);
  const barRef = useRef<HTMLDivElement>(null);
  useReservedBottomSpace(visible, barRef);
  /** Only this form's own submission reads as saving; any navigation
   * (a picker reloading the page) still disables the buttons. */
  const isSaving = state.status === "submitting";
  /**
   * Set while "Leave page" runs. The secondary button also closes the
   * dialog, and that close must not cancel the navigation it just allowed.
   */
  const leavingRef = useRef(false);
  const isBlocked = state.status === "blocked";
  useEffect(() => {
    // why: a Leave page whose navigation does not unmount the form (an
    // error boundary, a redirect back) must not swallow later dialog closes
    if (!isBlocked) leavingRef.current = false;
  }, [isBlocked]);

  if (!visible || typeof document === "undefined") return null;

  return (
    <>
      {createPortal(
        <div
          role="region"
          aria-label="Unsaved changes"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center pb-[env(safe-area-inset-bottom)] md:bottom-4 md:left-[var(--unsaved-bar-left)] md:right-auto md:w-[var(--unsaved-bar-width)] md:pb-0 xl:bottom-auto xl:top-3"
          style={
            bounds
              ? ({
                  "--unsaved-bar-left": `${bounds.left}px`,
                  "--unsaved-bar-width": `${bounds.width}px`,
                } as CSSProperties)
              : undefined
          }
        >
          <div
            ref={barRef}
            className="motion-reduce:animate-none pointer-events-auto flex w-full items-center justify-between gap-6 bg-gray-900 px-4 py-3 text-white shadow-xl duration-200 animate-in fade-in slide-in-from-bottom-2 md:w-auto md:rounded-xl md:py-2 md:pl-4 md:pr-2 xl:slide-in-from-top-2"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-white">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full bg-warning-500"
              />
              {isSaving ? "Saving..." : "Unsaved changes"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                // why: a ghost button on the dark surface
                className="border-white/30 bg-transparent text-white disabled:text-white/60 [&:is(button:enabled)]:hover:bg-white/10"
                onClick={onDiscard}
                disabled={disabled || isSaving}
              >
                Discard
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={onSave}
                disabled={disabled || isSaving || saveDisabled}
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
  /** The route's `useActionData()`; see `useUnsavedChanges`. */
  actionData?: unknown;
  /** `intent` values that save this form; see `useUnsavedChanges`. */
  saveIntents?: readonly string[];
  /** Puts every field back to the loaded values (the form remounts). */
  onDiscard: () => void;
  /** Field names excluded from the comparison, on top of the defaults. */
  ignore?: string[];
  /** Button whose name/value the bar's Save must send, if any. */
  getSubmitter?: () => HTMLButtonElement | null;
  /** Label of the Save button. Default "Save". */
  saveLabel?: string;
  /** Disables the bar's Save while the form's own Save is disabled. */
  saveDisabled?: boolean;
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
  actionData,
  saveIntents,
  onDiscard,
  ignore,
  getSubmitter,
  saveLabel,
  saveDisabled,
}: UnsavedChangesGuardProps) {
  const { state, discard, save } = useUnsavedChanges({
    formRef,
    actionData,
    saveIntents,
    onDiscard,
    ignore,
  });
  return (
    <UnsavedChangesBar
      state={state}
      onDiscard={discard}
      onSave={() => save(getSubmitter?.())}
      saveLabel={saveLabel}
      saveDisabled={saveDisabled}
    />
  );
}
