import type { RefObject } from "react";
import { useState, useCallback, useRef } from "react";
import type { ViewMountArg } from "@fullcalendar/core";
import type FullCalendar from "@fullcalendar/react";
import { scrollToNow } from "~/utils/calendar";

interface UseCalendarNowIndicatorFixOptions {
  /**
   * The calendar's resource rows. Only their presence matters here: switching
   * the view before FullCalendar has rows to lay out leaves the now indicator
   * unrendered, which is the whole problem this hook exists for.
   */
  resources: unknown[] | undefined;
  calendarRef: RefObject<FullCalendar | null>;
  targetView: string;
  setCalendarView: (view: string) => void;
}

/**
 * Custom hook to fix the FullCalendar now indicator issue by switching views
 * and ensuring the calendar is ready for interaction.
 * The issue is that nowIndicator does not work properly when the default view is not resourceTimelineDay.
 * This hook switches the view to the target view (resourceTimelineMonth) when the calendar is ready,
 * and ensures the now indicator is visible. More details about the issue can be found here: https://claude.ai/public/artifacts/18c76b8a-19af-46fd-a596-e37e8c9f8264
 *
 * Two entry points race to trigger that switch, and exactly one must win:
 * `nowIndicatorDidMount` is the fast path, and `viewDidMount` is the fallback
 * for a calendar that never renders an indicator at all.
 */
export function useCalendarNowIndicatorFix({
  resources,
  calendarRef,
  targetView,
  setCalendarView,
}: UseCalendarNowIndicatorFixOptions) {
  const [isCalendarReady, setIsCalendarReady] = useState(false);

  /**
   * Whether the one automatic switch to the target view has been started.
   *
   * A ref, not state: both entry points test it from inside a `setTimeout`, and
   * a state value read there is as old as the timer that captured it, so the
   * fallback would still see `false` 200ms after the fast path had already run
   * and would switch the view and scroll to now a second time.
   *
   * It marks the attempt, not its completion. A calendar API that never
   * materialises is therefore not retried.
   */
  const hasStartedViewSwitchRef = useRef(false);

  const timersRef = useRef<Set<NodeJS.Timeout>>(new Set());

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  const addTimer = useCallback((timer: NodeJS.Timeout) => {
    timersRef.current.add(timer);
  }, []);

  const removeTimer = useCallback((timer: NodeJS.Timeout) => {
    timersRef.current.delete(timer);
  }, []);

  const switchToTargetView = useCallback(() => {
    if (
      hasStartedViewSwitchRef.current ||
      !resources ||
      resources.length === 0
    ) {
      return;
    }
    hasStartedViewSwitchRef.current = true;

    const timer1 = setTimeout(() => {
      removeTimer(timer1);
      const calendarApi = calendarRef.current?.getApi();
      if (calendarApi) {
        calendarApi.changeView(targetView);
        setCalendarView(targetView);

        const timer2 = setTimeout(() => {
          removeTimer(timer2);
          setIsCalendarReady(true);
          scrollToNow();
        }, 150);
        addTimer(timer2);
      }
    }, 50);
    addTimer(timer1);
  }, [
    resources,
    targetView,
    calendarRef,
    setCalendarView,
    addTimer,
    removeTimer,
  ]);

  const handleNowIndicatorDidMount = useCallback(() => {
    switchToTargetView();
  }, [switchToTargetView]);

  const handleViewDidMount = useCallback(
    (mountInfo: ViewMountArg) => {
      if (
        mountInfo.view.type !== "resourceTimelineDay" ||
        hasStartedViewSwitchRef.current ||
        !resources ||
        resources.length === 0
      ) {
        return;
      }
      // Give the now indicator a chance to mount and take the fast path first.
      // switchToTargetView is a no-op if it did, so no second guard is needed.
      const timer = setTimeout(() => {
        removeTimer(timer);
        switchToTargetView();
      }, 200);
      addTimer(timer);
    },
    [resources, switchToTargetView, addTimer, removeTimer]
  );

  // Cleanup function
  const cleanup = useCallback(() => {
    clearAllTimers();
  }, [clearAllTimers]);

  return {
    isCalendarReady,
    handleNowIndicatorDidMount,
    handleViewDidMount,
    cleanup,
  };
}
