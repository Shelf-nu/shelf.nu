/**
 * Regression test for the `reminders.data` infinite-revalidation-loop
 * incident: creating a reminder redirects to `?...&success=true`, and the
 * dialog's `handleOnSuccess` effect must handle that signal (close the
 * dialog + strip the param) exactly once — not on every re-render while the
 * strip navigation is still committing.
 *
 * Also covers the follow-up "21x mini-storm" fix: the reminders table mounts
 * one create dialog plus one closed edit dialog per row, and every mounted
 * instance observes the same `?success=true` param. Only the dialog that is
 * actually `open` may act on it — a closed instance must not call `onClose`
 * or `setSearchParams`.
 *
 * @see {@link file://./set-or-edit-reminder-dialog.tsx}
 */
import type { ComponentProps, ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import SetOrEditReminderDialog, {
  createSetReminderSchema,
} from "./set-or-edit-reminder-dialog";

// why: TeamMembersSelector pulls in `useApiQuery` (a real network call) and is
// unrelated to the success-effect under test; stub it so the dialog can
// render without hitting the network.
vi.mock("./team-members-selector", () => ({
  default: () => <div data-testid="team-members-selector" />,
}));

// why: Dialog/DialogPortal pull in imperative <dialog> + Radix-adjacent focus
// trapping that is irrelevant to the success-effect under test; render
// children directly (mirrors asset-image/component.test.tsx's stub).
vi.mock("../layout/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogPortal: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

// why: the dialog reads `useFormatPrefs()` and its embedded `DateTimePicker`
// reads `useDateFormatter()`; both funnel through `useRequestInfo().formatPrefs`,
// which needs the root data-router loader (absent under MemoryRouter). Stub the
// resolved prefs so the dialog renders — the success-effect under test is
// prefs-agnostic.
vi.mock("~/utils/request-info", () => ({
  useRequestInfo: () => ({
    formatPrefs: {
      dateFormat: "MM_DD_YYYY",
      timeFormat: "H12",
      weekStartsOn: 0,
      timeZone: "UTC",
    },
  }),
}));

/** Total times any `onClose` instance handed to the dialog was invoked. */
let onCloseCallCount = 0;
/** Returns a fresh `onClose` reference each call — mirrors the pre-fix
 * `RemindersTable`/`ActionsDropdown` inline arrow (a new identity every
 * render) so the test proves the effect is loop-proof even when a caller
 * does NOT stabilize `onClose`. */
function makeOnClose() {
  return () => {
    onCloseCallCount += 1;
  };
}

/** Total times `setSearchParams` was invoked, across every distinct function
 * identity handed out below (the mock intentionally returns a new closure
 * per render, like the pre-memoization `customSetSearchParams`). */
let setSearchParamsCallCount = 0;
/** Backing store for the mocked `searchParams`; reassigned between renders in
 * the tests below to control what `searchParams.get("success")` returns and
 * to force the effect's dependency array to change identity across
 * re-renders (a real `URLSearchParams` never has stable identity across
 * `customSetSearchParams` calls either). */
let currentSearchParams = new URLSearchParams();

// why: control search params without a real router; mirrors the pattern in
// list/filters/sort-by.test.tsx for components that read `~/hooks/search-params`.
// A new setter closure is returned on every call to reproduce the incident's
// unstable `customSetSearchParams` identity, proving the ref-latch guard
// (not identity stability) is what makes the effect loop-proof.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () =>
    [
      currentSearchParams,
      (...args: unknown[]) => {
        setSearchParamsCallCount += 1;
        const [nextInit] = args;
        // Apply the updater so the "success" key is actually removed,
        // matching real `setSearchParams` semantics used by the effect.
        if (typeof nextInit === "function") {
          currentSearchParams = (
            nextInit as (prev: URLSearchParams) => URLSearchParams
          )(currentSearchParams);
        }
      },
    ] as const,
}));

// why: useNavigation/useActionData require a data router (RouterProvider),
// which is unnecessary ceremony for this effect-focused test; stub them.
// useLocation and the plain <Form> are overridden too so no data-router
// context is needed at all — only `MemoryRouter` (for the real `Link` inside
// the "See a sample" Button) is required.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useNavigation: () => ({ state: "idle" as const }),
    useActionData: () => undefined,
    useLocation: () => ({ pathname: "/assets/asset-1" }),
    Form: (props: ComponentProps<"form">) => <form {...props} />,
  };
});

/**
 * Renders the dialog inside a `MemoryRouter`. Defaults to `open={true}` since
 * most tests below exercise the "originating" dialog whose submit produced
 * the success param; pass `open: false` to simulate a sibling row's closed
 * edit dialog observing the same param.
 */
function renderDialog(onClose: () => void, { open = true } = {}) {
  return render(
    <MemoryRouter>
      <SetOrEditReminderDialog open={open} onClose={onClose} />
    </MemoryRouter>
  );
}

describe("SetOrEditReminderDialog success-handling effect", () => {
  beforeEach(() => {
    onCloseCallCount = 0;
    setSearchParamsCallCount = 0;
    currentSearchParams = new URLSearchParams();
  });

  it("calls onClose and setSearchParams exactly once when success=true, even across re-renders with unstable identities", () => {
    currentSearchParams = new URLSearchParams("success=true");

    const { rerender } = renderDialog(makeOnClose());

    expect(onCloseCallCount).toBe(1);
    expect(setSearchParamsCallCount).toBe(1);
    // The mocked setter applied the updater, so success should be stripped —
    // but simulate the incident condition where the strip navigation hasn't
    // committed yet: the effect may still see a re-render with the OLD
    // (uncommitted) `success=true` params, exactly like the production bug.
    currentSearchParams = new URLSearchParams("success=true");

    // Re-render a couple more times with brand-new `onClose`/`searchParams`
    // identities (as the pre-fix inline arrow + unmemoized setter would
    // produce on every parent re-render).
    rerender(
      <MemoryRouter>
        <SetOrEditReminderDialog open onClose={makeOnClose()} />
      </MemoryRouter>
    );
    currentSearchParams = new URLSearchParams("success=true");
    rerender(
      <MemoryRouter>
        <SetOrEditReminderDialog open onClose={makeOnClose()} />
      </MemoryRouter>
    );

    // The one-shot latch must have prevented any further action.
    expect(onCloseCallCount).toBe(1);
    expect(setSearchParamsCallCount).toBe(1);
  });

  it("does not call onClose or setSearchParams when success is absent", () => {
    currentSearchParams = new URLSearchParams();

    renderDialog(makeOnClose());

    expect(onCloseCallCount).toBe(0);
    expect(setSearchParamsCallCount).toBe(0);
  });

  it("does not call onClose or setSearchParams when the dialog is not open, even if success=true", () => {
    // Simulates a sibling row's closed edit dialog: every mounted instance
    // of SetOrEditReminderDialog observes the same `?success=true` param
    // after ANY row's create/edit submits, but only the dialog that is
    // actually `open` should react — otherwise an N-row page produces N
    // competing navigations/revalidations (the "21x mini-storm" bug).
    currentSearchParams = new URLSearchParams("success=true");

    renderDialog(makeOnClose(), { open: false });

    expect(onCloseCallCount).toBe(0);
    expect(setSearchParamsCallCount).toBe(0);
  });

  it("re-arms after success clears, so creating a second reminder auto-closes again", () => {
    currentSearchParams = new URLSearchParams("success=true");
    const { rerender } = renderDialog(makeOnClose());

    expect(onCloseCallCount).toBe(1);
    expect(setSearchParamsCallCount).toBe(1);

    // The strip navigation commits: `success` is now gone from the URL.
    currentSearchParams = new URLSearchParams();
    rerender(
      <MemoryRouter>
        <SetOrEditReminderDialog open onClose={makeOnClose()} />
      </MemoryRouter>
    );

    expect(onCloseCallCount).toBe(1);
    expect(setSearchParamsCallCount).toBe(1);

    // A second reminder is created: the form redirects to `?success=true`
    // again. The latch must have re-armed so this is handled too.
    currentSearchParams = new URLSearchParams("success=true");
    rerender(
      <MemoryRouter>
        <SetOrEditReminderDialog open onClose={makeOnClose()} />
      </MemoryRouter>
    );

    expect(onCloseCallCount).toBe(2);
    expect(setSearchParamsCallCount).toBe(2);
  });
});

/**
 * Regression tests for the reminder future-date validation:
 *
 * - The cutoff must be evaluated PER validation (fresh `now`), not captured
 *   once when the schema is built — otherwise a long-lived process drifts and
 *   validates against a stale moment.
 * - The cutoff must interpret the submitted wall-clock in the acting user's
 *   timezone (matching persistence), so the SAME wall-clock string is judged
 *   future-or-past correctly regardless of the runtime/browser zone.
 *
 * All assertions pin `now` to a fixed UTC instant via fake timers, so they are
 * independent of the machine timezone the suite runs on.
 */
describe("createSetReminderSchema future-date validation", () => {
  /** Fixed reference instant: 2026-07-23T12:00:00Z. */
  const NOW_UTC = new Date("2026-07-23T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_UTC);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Parses only the `alertDateTime` field so we don't have to satisfy the
   * other required fields for a validity check on the date alone.
   */
  function validateAlertDateTime(
    wallClock: string,
    options?: { timeZone?: string }
  ) {
    return createSetReminderSchema(options).shape.alertDateTime.safeParse(
      wallClock
    );
  }

  it("re-evaluates the cutoff against the CURRENT moment on every validation, not the moment the schema was built", () => {
    // Build the schema ONCE while `now` is 12:00Z.
    const schema = createSetReminderSchema({ timeZone: "UTC" });

    // 12:30 UTC is in the future relative to 12:00Z → valid.
    expect(
      schema.shape.alertDateTime.safeParse("2026-07-23T12:30").success
    ).toBe(true);

    // Advance the clock past that instant WITHOUT rebuilding the schema.
    vi.setSystemTime(new Date("2026-07-23T13:00:00.000Z"));

    // The very same schema + input is now in the PAST → invalid. A cutoff
    // frozen at build time (the original `.min(new Date())` bug) would still
    // report it as valid here.
    expect(
      schema.shape.alertDateTime.safeParse("2026-07-23T12:30").success
    ).toBe(false);
  });

  it("interprets the submitted wall-clock in the user's timezone so the same string is judged relative to persistence", () => {
    // now = 2026-07-23T12:00:00Z. Same wall-clock, opposite verdicts by zone:
    // - America/New_York (UTC-4 in July): 13:00 EDT = 17:00Z → future → valid.
    // - Europe/Berlin (UTC+2 in July): 13:00 CEST = 11:00Z → past → invalid.
    const wallClock = "2026-07-23T13:00";

    expect(
      validateAlertDateTime(wallClock, { timeZone: "America/New_York" }).success
    ).toBe(true);

    expect(
      validateAlertDateTime(wallClock, { timeZone: "Europe/Berlin" }).success
    ).toBe(false);
  });

  it("rejects a wall-clock that is in the past in the user's timezone", () => {
    // 09:00 UTC is before now (12:00Z) → past → invalid, with the same
    // user-facing message.
    const result = validateAlertDateTime("2026-07-23T09:00", {
      timeZone: "UTC",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Please select a date in the future"
      );
    }
  });

  it("surfaces the standard invalid-date error for an empty value (unchanged UX)", () => {
    const result = validateAlertDateTime("", { timeZone: "UTC" });
    expect(result.success).toBe(false);
  });
});
