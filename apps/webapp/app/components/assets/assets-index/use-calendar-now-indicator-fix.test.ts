import type { RefObject } from "react";
import { useEffect } from "react";
import type { ViewMountArg } from "@fullcalendar/core";
import type FullCalendar from "@fullcalendar/react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scrollToNow } from "~/utils/calendar";
import { useCalendarNowIndicatorFix } from "./use-calendar-now-indicator-fix";

// why: scrollToNow measures the rendered FullCalendar DOM and runs a timer of
// its own. The hook's contract is how many times it asks for a scroll, not what
// a scroll does.
vi.mock("~/utils/calendar", () => ({
  scrollToNow: vi.fn(),
}));

const TARGET_VIEW = "resourceTimelineMonth";

/** A `viewDidMount` payload for the view the calendar starts on. */
const DAY_VIEW_MOUNT = {
  view: { type: "resourceTimelineDay" },
} as unknown as ViewMountArg;

/**
 * Longer than the whole chain the hook schedules: a 200ms fallback, then 50ms
 * before the view change and 150ms more before the scroll.
 */
const PAST_EVERY_TIMER = 500;

function setup({
  resources = [{ id: "asset-1" }],
}: { resources?: unknown[] } = {}) {
  const changeView = vi.fn();
  const setCalendarView = vi.fn();
  const calendarRef = {
    current: { getApi: () => ({ changeView }) },
  } as unknown as RefObject<FullCalendar | null>;

  const rendered = renderHook(() => {
    const hook = useCalendarNowIndicatorFix({
      resources,
      calendarRef,
      targetView: TARGET_VIEW,
      setCalendarView,
    });
    // Mirror the consumer, which clears pending timers on unmount.
    useEffect(() => hook.cleanup, [hook.cleanup]);
    return hook;
  });

  return { ...rendered, changeView, setCalendarView };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useCalendarNowIndicatorFix", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("switches to the target view once when only the now indicator mounts", () => {
    const { result, changeView, setCalendarView } = setup();

    act(() => {
      result.current.handleNowIndicatorDidMount();
    });
    advance(PAST_EVERY_TIMER);

    expect(changeView).toHaveBeenCalledTimes(1);
    expect(changeView).toHaveBeenCalledWith(TARGET_VIEW);
    expect(setCalendarView).toHaveBeenCalledTimes(1);
    expect(scrollToNow).toHaveBeenCalledTimes(1);
    expect(result.current.isCalendarReady).toBe(true);
  });

  it("switches to the target view once when the now indicator never mounts", () => {
    const { changeView, result } = setup();

    act(() => {
      result.current.handleViewDidMount(DAY_VIEW_MOUNT);
    });
    advance(PAST_EVERY_TIMER);

    expect(changeView).toHaveBeenCalledTimes(1);
    expect(scrollToNow).toHaveBeenCalledTimes(1);
  });

  // The fallback timer is 200ms, so any gap shorter than that leaves it pending
  // at the moment the fast path runs. It must not switch the view a second time.
  it.each([0, 15, 50, 100, 150, 199])(
    "switches only once when the now indicator mounts %ims after the view",
    (gap) => {
      const { changeView, setCalendarView, result } = setup();

      act(() => {
        result.current.handleViewDidMount(DAY_VIEW_MOUNT);
      });
      advance(gap);
      act(() => {
        result.current.handleNowIndicatorDidMount();
      });
      advance(PAST_EVERY_TIMER);

      expect(changeView).toHaveBeenCalledTimes(1);
      expect(setCalendarView).toHaveBeenCalledTimes(1);
      expect(scrollToNow).toHaveBeenCalledTimes(1);
    }
  );

  it("switches only once when the now indicator remounts", () => {
    const { changeView, result } = setup();

    act(() => {
      result.current.handleNowIndicatorDidMount();
      result.current.handleNowIndicatorDidMount();
    });
    advance(PAST_EVERY_TIMER);

    expect(changeView).toHaveBeenCalledTimes(1);
  });

  it("waits for resources before switching", () => {
    const { changeView, result } = setup({ resources: [] });

    act(() => {
      result.current.handleNowIndicatorDidMount();
      result.current.handleViewDidMount(DAY_VIEW_MOUNT);
    });
    advance(PAST_EVERY_TIMER);

    expect(changeView).not.toHaveBeenCalled();
    expect(scrollToNow).not.toHaveBeenCalled();
    expect(result.current.isCalendarReady).toBe(false);
  });

  it("ignores a view mount that is not the starting day view", () => {
    const { changeView, result } = setup();

    act(() => {
      result.current.handleViewDidMount({
        view: { type: TARGET_VIEW },
      } as unknown as ViewMountArg);
    });
    advance(PAST_EVERY_TIMER);

    expect(changeView).not.toHaveBeenCalled();
  });

  it("drops pending timers when the calendar unmounts", () => {
    const { changeView, result, unmount } = setup();

    act(() => {
      result.current.handleNowIndicatorDidMount();
    });
    unmount();
    advance(PAST_EVERY_TIMER);

    expect(changeView).not.toHaveBeenCalled();
    expect(scrollToNow).not.toHaveBeenCalled();
  });
});
