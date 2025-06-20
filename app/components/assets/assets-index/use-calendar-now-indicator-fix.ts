import { useState, useCallback, useRef } from "react";
import type FullCalendar from "@fullcalendar/react";
import { scrollToNow } from "~/utils/calendar";

interface UseCalendarNowIndicatorFixOptions {
  resources: any[] | undefined;
  calendarRef: React.RefObject<FullCalendar>;
  targetView: string;
  setCalendarView: (view: string) => void;
}

/**
 * Custom hook to fix the FullCalendar now indicator issue by switching views
 * and ensuring the calendar is ready for interaction.
 * The issue is that nowIndicator does not work properly when the default view is not resourceTimelineDay.
 * This hook switches the view to the target view (resourceTimelineMonth) when the calendar is ready,
 * and ensures the now indicator is visible. More details about the issue can be found here: https://claude.ai/public/artifacts/18c76b8a-19af-46fd-a596-e37e8c9f8264
 */
export function useCalendarNowIndicatorFix({
  resources,
  calendarRef,
  targetView,
  setCalendarView,
}: UseCalendarNowIndicatorFixOptions) {
  const [isCalendarReady, setIsCalendarReady] = useState(false);
  const [hasInitialViewSwitched, setHasInitialViewSwitched] = useState(false);

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
    if (!hasInitialViewSwitched && resources && resources.length > 0) {
      setHasInitialViewSwitched(true);

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
    }
  }, [
    hasInitialViewSwitched,
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
    (mountInfo: any) => {
      if (
        mountInfo.view.type === "resourceTimelineDay" &&
        !hasInitialViewSwitched &&
        resources &&
        resources.length > 0
      ) {
        const timer = setTimeout(() => {
          removeTimer(timer);
          if (!hasInitialViewSwitched) {
            switchToTargetView();
          }
        }, 200);
        addTimer(timer);
      }
    },
    [
      hasInitialViewSwitched,
      resources,
      switchToTargetView,
      addTimer,
      removeTimer,
    ]
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
