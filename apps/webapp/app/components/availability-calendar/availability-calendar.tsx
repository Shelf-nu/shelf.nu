import { useEffect, useRef, useState } from "react";
import type { CustomContentGenerator, EventInput } from "@fullcalendar/core";
import FullCalendar from "@fullcalendar/react";
import type {
  ResourceInput,
  ResourceLabelContentArg,
} from "@fullcalendar/resource/index.js";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import { useLoaderData } from "react-router";
import { ClientOnly } from "remix-utils/client-only";
import { CalendarNavigation } from "~/components/calendar/calendar-navigation";
import renderEventCard from "~/components/calendar/event-card";
import TitleContainer from "~/components/calendar/title-container";
import { ViewButtonGroup } from "~/components/calendar/view-button-group";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import {
  getCalendarTitleAndSubtitle,
  getStatusClasses,
  handleEventClick,
  handleEventMouseEnter,
  handleEventMouseLeave,
  isOneDayEvent,
  scrollToNow,
} from "~/utils/calendar";
import { getWeekStartingAndEndingDates } from "~/utils/date-fns";
import { FULL_CALENDAR_LICENSE_KEY } from "~/utils/env";
import { tw } from "~/utils/tw";
import { useCalendarNowIndicatorFix } from "../assets/assets-index/use-calendar-now-indicator-fix";

const DEFAULT_CALENDAR_VIEW = "resourceTimelineDay";
const TARGET_CALENDAR_VIEW = "resourceTimelineMonth";

export default function AvailabilityCalendar({
  resources,
  events,
  resourceLabelContent,
}: {
  resources: ResourceInput[];
  events: EventInput[];
  resourceLabelContent: CustomContentGenerator<ResourceLabelContentArg>;
}) {
  const { items, modelName, totalItems, perPage, timeZone } =
    useLoaderData<AssetIndexLoaderData>();
  const { singular, plural } = modelName;
  const calendarRef = useRef<FullCalendar>(null);
  const [startingDay, endingDay] = getWeekStartingAndEndingDates(new Date());
  const [calendarHeader, setCalendarHeader] = useState<{
    title?: string;
    subtitle?: string;
  }>({
    title: "",
    subtitle: `${startingDay} - ${endingDay}`,
  });

  const [calendarView, setCalendarView] = useState(TARGET_CALENDAR_VIEW);

  const updateTitle = (viewType = calendarView) => {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      setCalendarHeader(getCalendarTitleAndSubtitle({ viewType, calendarApi }));
    }
  };

  /**
   * IMPORTANT: This hook only works on page relaod. The indicator actually breaks on HMR. This is still pending to be fixed
   */
  const {
    isCalendarReady,
    handleNowIndicatorDidMount,
    handleViewDidMount,
    cleanup,
  } = useCalendarNowIndicatorFix({
    resources,
    calendarRef,
    targetView: TARGET_CALENDAR_VIEW,
    setCalendarView,
  });

  function handleViewChange(view: string) {
    setCalendarView(view);
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.changeView(view);
    updateTitle(view);
  }

  // Handle normal view changes and scrolling
  const handleDatesSet = () => {
    scrollToNow();
  };

  // Cleanup timers on unmount
  useEffect(() => cleanup, [cleanup]);

  return (
    <div>
      <div className="flex items-center justify-between gap-4 rounded-t-md border bg-surface px-4 py-3">
        <TitleContainer
          calendarTitle={calendarHeader.title}
          calendarSubtitle={calendarHeader.subtitle}
          calendarView={calendarView}
        />

        <div className="flex items-center">
          <CalendarNavigation
            calendarRef={calendarRef}
            updateTitle={() => updateTitle(calendarView)}
          />

          <ViewButtonGroup
            views={[
              { label: "Month", value: "resourceTimelineMonth" },
              { label: "Week", value: "resourceTimelineWeek" },
              { label: "Day", value: "resourceTimelineDay" },
            ]}
            currentView={calendarView}
            onViewChange={handleViewChange}
          />
        </div>
      </div>

      {/* hellow rld */}
      <div className="relative">
        <ClientOnly fallback={<CalendarLoadingFallback />}>
          {() => (
            <FullCalendar
              ref={calendarRef}
              height="auto"
              timeZone={timeZone}
              nowIndicator
              slotEventOverlap
              eventTimeFormat={{
                hour: "numeric",
                minute: "2-digit",
                meridiem: "short",
              }}
              eventMouseEnter={handleEventMouseEnter("resourceTimelineMonth")}
              eventMouseLeave={handleEventMouseLeave("resourceTimelineMonth")}
              eventClick={handleEventClick}
              resourceOrder="none"
              plugins={[resourceTimelinePlugin]}
              schedulerLicenseKey={FULL_CALENDAR_LICENSE_KEY}
              initialView={DEFAULT_CALENDAR_VIEW}
              headerToolbar={false}
              resources={resources}
              events={events}
              resourceAreaHeaderContent={
                <div className="px-2 py-1">
                  <div
                    className={tw(
                      "text-left text-text-sm font-semibold capitalize text-color-900"
                    )}
                  >
                    {plural}
                  </div>
                  <div>
                    {perPage < totalItems ? (
                      <p>
                        {items.length} {items.length > 1 ? plural : singular}{" "}
                        <span className="text-color-400">
                          out of {totalItems}
                        </span>
                      </p>
                    ) : (
                      <p>
                        <span>
                          {totalItems} {items.length === 1 ? singular : plural}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              }
              resourceAreaHeaderClassNames="text-md font-semibold text-color-900"
              views={{
                resourceTimelineMonth: {
                  slotLabelFormat: [
                    { month: "long", year: "numeric" },
                    { weekday: "short", day: "2-digit" },
                  ],
                },
                resourceTimelineWeek: {
                  slotLabelFormat: [
                    { weekday: "long", month: "short", day: "numeric" },
                    { hour: "numeric", meridiem: "short" },
                  ],
                },
                resourceTimelineDay: {
                  slotLabelFormat: [
                    { weekday: "short", month: "short", day: "numeric" },
                    { hour: "numeric", minute: "2-digit", meridiem: "short" },
                  ],
                },
              }}
              slotLabelFormat={[
                { month: "long", year: "numeric" },
                { weekday: "short", day: "2-digit" },
              ]}
              slotLabelClassNames="font-normal text-color-600"
              slotMinWidth={100}
              resourceLabelContent={resourceLabelContent}
              eventContent={(event) => renderEventCard(event)}
              eventClassNames={(eventInfo) => {
                const viewType = eventInfo.view.type;
                const isOneDay = isOneDayEvent(
                  eventInfo.event.start,
                  eventInfo.event.end
                );

                return getStatusClasses(
                  eventInfo.event.extendedProps.status,
                  isOneDay,
                  viewType
                );
              }}
              nowIndicatorDidMount={handleNowIndicatorDidMount}
              viewDidMount={handleViewDidMount}
              datesSet={handleDatesSet}
            />
          )}
        </ClientOnly>

        {/* Loading Overlay */}
        {!isCalendarReady && <CalendarLoadingFallback />}
      </div>
    </div>
  );
}

function CalendarLoadingFallback() {
  return (
    <div className="bg-surface/90 absolute inset-0 z-10 flex justify-center">
      <div className="flex flex-col items-center gap-4 pt-[300px]">
        <FallbackLoading className="size-16" />
        <p className="text-sm text-color-600">Loading calendar...</p>
      </div>
    </div>
  );
}
