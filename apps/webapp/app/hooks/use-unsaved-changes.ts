/**
 * Unsaved Changes Tracking
 *
 * Tells a create or edit form whether it differs from the values it loaded
 * with, and guards leaving the page while it does.
 *
 * Dirty state is a diff of two `FormData` snapshots: a baseline read one
 * frame after mount (and again after a successful save or a Discard), and
 * the current values, re-read after any input/change/click/keyup and on a
 * one-second interval. Widgets that submit through hidden inputs are
 * covered without per-input wiring. Comparisons pause while a navigation
 * runs, because forms disable their inputs meanwhile and `FormData` leaves
 * disabled fields out.
 *
 * Leave guard: while dirty, a navigation is blocked unless it stays on the
 * form's page (its resolved `action` pathname) or one of its child routes,
 * such as a booking's manage-assets modal. This form's own submission is
 * never blocked, and closing or reloading the tab shows the browser prompt.
 *
 * Every mounted instance registers a `useBlocker`, and React Router honours
 * only the most recently registered one. Mount the hook only where tracking
 * applies (render `UnsavedChangesGuard` conditionally); never mount it in a
 * dialog that sits on another form's page.
 *
 * @see {@link file://./../components/forms/unsaved-changes-bar.tsx}
 * @see {@link file://./use-discard-remount.ts}
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RefCallback, RefObject } from "react";
import { useBlocker, useNavigation } from "react-router";

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
  // The end date the expired-reservation check-out prompt posts. It belongs
  // to the check-out, not to the booking form it submits through, and it
  // only exists while the prompt is open; see `CheckoutDialog`.
  "expiredCheckoutNewTo",
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
  return serializeEntries(new FormData(form), ignored);
}

/**
 * Serializes `FormData` entries the way {@link serializeFormSnapshot} does,
 * so a navigation's submitted `formData` can be matched against a snapshot.
 */
function serializeEntries(
  formData: FormData,
  ignored: ReadonlySet<string>
): string {
  const entries: string[] = [];
  for (const [name, value] of formData) {
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
 * True when an action result reports success. Shelf actions answer a failed
 * save with an `error` payload (a validation or `ShelfError` response) and a
 * successful one with `error` absent or `null`.
 */
function isSuccessfulActionData(actionData: unknown) {
  if (typeof actionData !== "object" || actionData === null) return false;
  return !("error" in actionData) || actionData.error == null;
}

/**
 * True when `next` is the form's page or a child route of it, for example a
 * booking's manage-assets modal under the booking pathname, or closing that
 * modal back to the booking.
 */
function staysOnPage(page: string, next: string) {
  const base = page.endsWith("/") ? page.slice(0, -1) : page;
  return next === page || next === base || next.startsWith(`${base}/`);
}

/**
 * Pathname of the page a form lives on: its resolved `action` attribute.
 * React Router resolves it against the route that renders the form, so it
 * stays the form's page while a child route (a modal) is open.
 */
function formPagePathname(form: HTMLFormElement | null, fallback: string) {
  const action = form?.getAttribute("action");
  return action ? new URL(action, "http://localhost").pathname : fallback;
}

type UseUnsavedChangesOptions = {
  /** The form whose submitted values are tracked. */
  formRef: RefObject<HTMLFormElement | null>;
  /** Field names excluded from the comparison, on top of the defaults. */
  ignore?: string[];
  /**
   * The route's `useActionData()`. When this form's own saving submission
   * settles with a successful result (no `error`) the baseline is re-taken;
   * an `error` result keeps the form dirty. Settling with no action data
   * means the action redirected, which these actions only do on success, so
   * the form is clean then too. Results of other forms on the page never
   * touch the baseline.
   */
  actionData?: unknown;
  /**
   * `intent` values whose submission saves this form's fields. Omit it when
   * every submission of the form is a save. Forms that also submit other
   * intents (a booking's check-out) list only the saving ones, so those
   * other submissions keep the form dirty.
   */
  saveIntents?: readonly string[];
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
 * Mount it only where tracking applies: a mounted instance always
 * registers a blocker, which overrides any guard registered before it.
 *
 * @returns The current state, plus `discard`, `save` and `markClean`
 */
export function useUnsavedChanges({
  formRef,
  ignore,
  actionData,
  saveIntents,
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

  const navigation = useNavigation();
  /**
   * True while any navigation runs. Forms disable their inputs meanwhile,
   * and `FormData` leaves disabled fields out, so a snapshot taken then
   * would differ from the baseline although nothing changed.
   */
  const navigatingRef = useRef(false);

  const check = useCallback(() => {
    const form = formRef.current;
    if (!form || baselineRef.current === null || navigatingRef.current) {
      return;
    }
    setIsDirty(serializeFormSnapshot(form, ignored) !== baselineRef.current);
  }, [formRef, ignored]);

  /** Set when a re-baseline is asked for mid-navigation; runs on idle. */
  const pendingCleanRef = useRef(false);

  const markClean = useCallback(() => {
    setIsDirty(false);
    // why: inputs are disabled until the navigation settles, so a baseline
    // read now would be missing them
    if (navigatingRef.current) {
      pendingCleanRef.current = true;
      return;
    }
    const form = formRef.current;
    baselineRef.current = form ? serializeFormSnapshot(form, ignored) : null;
  }, [formRef, ignored]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
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
    // why: fires for the form's own Save buttons, requestSubmit and a
    // submitter elsewhere on the page (`form=` attribute), and for nothing
    // else, so it tells this form's submissions apart from other forms'
    const onSubmit = () =>
      setSubmittedSnapshot(serializeFormSnapshot(form, ignored));
    form.addEventListener("submit", onSubmit);
    return () => {
      cancelAnimationFrame(baselineFrame);
      cancelAnimationFrame(pendingFrame);
      CHECK_EVENTS.forEach((type) =>
        doc.removeEventListener(type, scheduleCheck, true)
      );
      clearInterval(interval);
      form.removeEventListener("submit", onSubmit);
    };
  }, [formRef, check, markClean, ignored]);

  // why: a layout effect, so the flag is set before the next frame's check
  // reads a DOM that already has its inputs disabled
  useLayoutEffect(() => {
    navigatingRef.current = navigation.state !== "idle";
    if (navigatingRef.current) return;
    if (pendingCleanRef.current) {
      pendingCleanRef.current = false;
      markClean();
    } else {
      check();
    }
  }, [navigation.state, check, markClean]);

  /**
   * What this form held when it last fired `submit`. A navigation is this
   * form's submission only when its `formData` matches it; any other form
   * on the page (a booking's remove-asset row, its archive action) submits
   * different entries.
   */
  const [submittedSnapshot, setSubmittedSnapshot] = useState<string | null>(
    null
  );
  const submittedFormData =
    navigation.state !== "idle" &&
    navigation.formMethod !== undefined &&
    navigation.formMethod.toUpperCase() !== "GET"
      ? navigation.formData
      : undefined;
  const navigationSnapshot = useMemo(
    () =>
      submittedFormData ? serializeEntries(submittedFormData, ignored) : null,
    [submittedFormData, ignored]
  );
  const isSubmitting =
    navigationSnapshot !== null && navigationSnapshot === submittedSnapshot;
  const saveIntentsKey = (saveIntents ?? []).join(",");
  const submittedIntent = submittedFormData?.get("intent");
  /** This form's submission saves its fields (see `saveIntents`). */
  const isSaving =
    isSubmitting &&
    (saveIntents === undefined ||
      (typeof submittedIntent === "string" &&
        saveIntentsKey.split(",").includes(submittedIntent)));

  /**
   * Set while this form's submission runs, with whether it saves. When a
   * saving submission settles with a successful result, or with no action
   * data at all (React Router clears action data on a redirect, for example
   * back to this same edit page), the form is clean. A failed save settles
   * with an `error` payload and stays dirty.
   */
  const submissionRef = useRef<{ saves: boolean } | null>(null);
  useEffect(() => {
    if (isSubmitting) {
      submissionRef.current = { saves: isSaving };
      return;
    }
    const submission = submissionRef.current;
    if (!submission) return;
    submissionRef.current = null;
    setSubmittedSnapshot(null);
    if (!submission.saves) return;
    if (actionData === undefined) requestAnimationFrame(markClean);
    else if (isSuccessfulActionData(actionData)) markClean();
  }, [isSubmitting, isSaving, actionData, markClean]);

  const shouldGuard = isDirty && !isSubmitting;

  /**
   * `shouldGuard` as of the last commit, for the blocker to read.
   *
   * React Router hands a changed blocker function to the router in a passive
   * effect, which runs after the commit that shows "dirty". A navigation
   * started in between would reach the stale function and leave unguarded.
   * The blocker below keeps one identity and reads this ref instead, which a
   * layout effect updates during the commit itself.
   */
  const shouldGuardRef = useRef(shouldGuard);
  useLayoutEffect(() => {
    shouldGuardRef.current = shouldGuard;
  }, [shouldGuard]);

  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        shouldGuardRef.current &&
        !staysOnPage(
          formPagePathname(formRef.current, currentLocation.pathname),
          nextLocation.pathname
        ),
      [formRef]
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
  } else if (!isDirty) {
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
   * route on `intent`. A disabled submitter means the form cannot be saved
   * yet, so nothing is submitted.
   */
  const save = useCallback(
    (submitter?: HTMLButtonElement | null) => {
      const form = formRef.current;
      if (!form) return;
      // why: requestSubmit ignores the submitter's disabled state
      if (submitter?.disabled) return;
      if (submitter) form.requestSubmit(submitter);
      else form.requestSubmit();
    },
    [formRef]
  );

  return {
    state,
    isDirty,
    discard,
    save,
    markClean,
  };
}

/**
 * A form ref shared by the unsaved-changes tracking and the form's own ref
 * callback (Zorm's `zo.ref`, or a state setter).
 *
 * @param onNode - Stable callback that also receives the form element
 * @returns `formRef` to pass to `UnsavedChangesGuard`, and `setFormRef` to
 * pass as the form's `ref`
 */
export function useTrackedFormRef(
  onNode: (node: HTMLFormElement | null) => void
) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const setFormRef = useCallback<RefCallback<HTMLFormElement>>(
    (node) => {
      onNode(node);
      formRef.current = node;
    },
    [onNode]
  );
  return { formRef, setFormRef };
}
