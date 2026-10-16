import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useBlocker, useLocation, useNavigation } from "react-router";

/**
 * Where a form stands relative to what was loaded.
 *
 * - `clean`: nothing differs from the loaded values.
 * - `dirty`: at least one submitted value differs.
 * - `submitting`: dirty and this form is being saved right now.
 * - `blocked`: dirty and the user tried to leave; `proceed` leaves and
 *   loses the changes, `stay` cancels the navigation.
 */
export type UnsavedChangesState =
  | { status: "clean" }
  | { status: "dirty" }
  | { status: "submitting" }
  | { status: "blocked"; proceed: () => void; stay: () => void };

/**
 * Hidden fields that steer the request rather than carry user data, so a
 * different value there never means the user changed something.
 */
export const UNSAVED_CHANGES_DEFAULT_IGNORE = [
  "redirectTo",
  "intent",
  "nameChangeOnly",
  "addAnother",
];

/** DOM events that can precede a change of a submitted value. */
const CHECK_EVENTS = ["input", "change", "click", "keyup"] as const;

/** Safety net for values set programmatically with no user event. */
const CHECK_INTERVAL_MS = 1000;

/**
 * Serializes what the form would submit into one comparable string.
 *
 * Entries are sorted so DOM order does not matter. A picked file serializes
 * as `name:size:lastModified`; an empty file input serializes as empty.
 *
 * @param form - The form to read
 * @param ignored - Field names left out of the result
 * @returns A stable `name=value` string joined by `&`
 */
export function serializeFormSnapshot(
  form: HTMLFormElement,
  ignored: ReadonlySet<string>
): string {
  const entries: string[] = [];
  for (const [name, value] of new FormData(form)) {
    if (ignored.has(name)) continue;
    const serialized =
      typeof value === "string"
        ? value
        : value.size === 0 && value.name === ""
        ? ""
        : `${value.name}:${value.size}:${value.lastModified}`;
    entries.push(`${name}=${serialized}`);
  }
  return entries.sort().join("&");
}

/**
 * True when `next` is the same page or a child route of `current`, for
 * example a booking's manage-assets modal under the booking pathname.
 */
function staysOnPage(current: string, next: string) {
  const base = current.endsWith("/") ? current.slice(0, -1) : current;
  return next === current || next === base || next.startsWith(`${base}/`);
}

type UseUnsavedChangesOptions = {
  /** The form whose submitted values are tracked. */
  formRef: RefObject<HTMLFormElement | null>;
  /** Field names excluded from the comparison, on top of the defaults. */
  ignore?: string[];
  /** Bump to re-take the baseline, for example after a successful save. */
  savedToken?: unknown;
  /** When false the hook tracks nothing and never blocks. Default true. */
  enabled?: boolean;
  /**
   * Puts every field back to the loaded values. Forms remount themselves
   * here (a `key` bump), which resets widget state that lives in React.
   */
  onDiscard?: () => void;
};

/**
 * Tracks whether a form differs from its loaded values and guards leaving
 * the page while it does.
 *
 * Dirty state is a diff of `FormData` snapshots, so widgets that submit
 * through hidden inputs are covered without per-input wiring. While dirty,
 * navigating to another pathname is blocked (same-pathname and child-route
 * navigations are not) and closing or reloading the tab shows the browser's
 * own prompt. This form's own submission is never blocked.
 *
 * @returns The current state, plus `discard`, `save` and `markClean`
 */
export function useUnsavedChanges({
  formRef,
  ignore,
  savedToken,
  enabled = true,
  onDiscard,
}: UseUnsavedChangesOptions) {
  const [isDirty, setIsDirty] = useState(false);
  const baselineRef = useRef<string | null>(null);
  const ignoreKey = (ignore ?? []).join(",");
  const ignored = useMemo(
    () =>
      new Set([
        ...UNSAVED_CHANGES_DEFAULT_IGNORE,
        ...ignoreKey.split(",").filter(Boolean),
      ]),
    [ignoreKey]
  );

  const check = useCallback(() => {
    const form = formRef.current;
    if (!form || baselineRef.current === null) return;
    setIsDirty(serializeFormSnapshot(form, ignored) !== baselineRef.current);
  }, [formRef, ignored]);

  const markClean = useCallback(() => {
    const form = formRef.current;
    baselineRef.current = form ? serializeFormSnapshot(form, ignored) : null;
    setIsDirty(false);
  }, [formRef, ignored]);

  useEffect(() => {
    const form = formRef.current;
    if (!enabled || !form) return;
    // why: one frame after mount, so widgets that rewrite their own hidden
    // value on mount (EditorV2) are already in the DOM when the baseline is
    // read.
    const baselineFrame = requestAnimationFrame(markClean);
    let pendingFrame = 0;
    const scheduleCheck = () => {
      if (pendingFrame) return;
      // why: React has committed the hidden-input updates by the next frame.
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = 0;
        check();
      });
    };
    // why: on the document, because pickers render their options in portals
    // outside the form element.
    const doc = form.ownerDocument;
    CHECK_EVENTS.forEach((type) =>
      doc.addEventListener(type, scheduleCheck, true)
    );
    const interval = setInterval(check, CHECK_INTERVAL_MS);
    return () => {
      cancelAnimationFrame(baselineFrame);
      cancelAnimationFrame(pendingFrame);
      CHECK_EVENTS.forEach((type) =>
        doc.removeEventListener(type, scheduleCheck, true)
      );
      clearInterval(interval);
    };
  }, [enabled, formRef, check, markClean]);

  const lastSavedToken = useRef(savedToken);
  useEffect(() => {
    if (Object.is(lastSavedToken.current, savedToken)) return;
    lastSavedToken.current = savedToken;
    markClean();
  }, [savedToken, markClean]);

  const navigation = useNavigation();
  const location = useLocation();
  const isSubmitting =
    navigation.state !== "idle" &&
    navigation.formMethod !== undefined &&
    navigation.formMethod.toUpperCase() !== "GET" &&
    navigation.formAction !== undefined &&
    new URL(navigation.formAction, "http://localhost").pathname ===
      location.pathname;

  const shouldGuard = enabled && isDirty && !isSubmitting;

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        shouldGuard &&
        !staysOnPage(currentLocation.pathname, nextLocation.pathname),
      [shouldGuard]
    )
  );

  useEffect(() => {
    if (!shouldGuard) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // why: older browsers only prompt when returnValue is set.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [shouldGuard]);

  let state: UnsavedChangesState;
  if (blocker.state === "blocked") {
    state = {
      status: "blocked",
      proceed: () => blocker.proceed(),
      stay: () => blocker.reset(),
    };
  } else if (!enabled || !isDirty) {
    state = { status: "clean" };
  } else if (isSubmitting) {
    state = { status: "submitting" };
  } else {
    state = { status: "dirty" };
  }

  const discard = useCallback(() => {
    onDiscard?.();
    // why: a remounted form re-baselines on its own mount; this covers a
    // caller that resets without remounting.
    requestAnimationFrame(markClean);
  }, [onDiscard, markClean]);

  /**
   * Submits the form as its own Save button would.
   *
   * @param submitter - Button whose name/value must be sent, for forms that
   * route on `intent`
   */
  const save = useCallback(
    (submitter?: HTMLElement | null) => {
      const form = formRef.current;
      if (!form) return;
      if (submitter) form.requestSubmit(submitter);
      else form.requestSubmit();
    },
    [formRef]
  );

  return {
    state,
    isDirty: enabled && isDirty,
    discard,
    save,
    markClean,
  };
}
