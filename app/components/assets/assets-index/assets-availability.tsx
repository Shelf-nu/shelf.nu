import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import { useLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { CalendarNavigation } from "~/components/calendar/calendar-navigation";
import renderEventCard from "~/components/calendar/event-card";
import TitleContainer from "~/components/calendar/title-container";
import { ViewButtonGroup } from "~/components/calendar/view-button-group";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import { Button } from "~/components/shared/button";
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
import { AssetImage } from "../asset-image";
import { AssetStatusBadge } from "../asset-status-badge";
import { useAssetAvailabilityData } from "./use-asset-availability-data";
import { CategoryBadge } from "../category-badge";
import { useCalendarNowIndicatorFix } from "./use-calendar-now-indicator-fix";

const DEFAULT_CALENDAR_VIEW = "resourceTimelineDay";
const TARGET_CALENDAR_VIEW = "resourceTimelineMonth";

export default function AssetsAvailability() {
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

  const { resources, events } = useAssetAvailabilityData(items);

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
      <div className="flex items-center justify-between gap-4 rounded-t-md border bg-white px-4 py-3">
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
                  <h5 className="text-left capitalize">{plural}</h5>
                  <div>
                    {perPage < totalItems ? (
                      <p>
                        {items.length} {items.length > 1 ? plural : singular}{" "}
                        <span className="text-gray-400">
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
              resourceAreaHeaderClassNames="text-md font-semibold text-gray-900"
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
              slotLabelClassNames="font-normal text-gray-600"
              slotMinWidth={100}
              resourceLabelContent={({ resource }) => (
                <div className="flex items-center gap-2 px-2">
                  <AssetImage
                    asset={{
                      id: resource.id,
                      mainImage: resource.extendedProps?.mainImage,
                      thumbnailImage: resource.extendedProps?.thumbnailImage,
                      mainImageExpiration:
                        resource.extendedProps?.mainImageExpiration,
                    }}
                    alt={resource.title}
                    className="size-14 rounded border object-cover"
                    withPreview
                  />
                  <div className="flex flex-col gap-1">
                    <div className="min-w-0 flex-1 truncate">
                      <Button
                        to={`/assets/${resource.id}`}
                        variant="link"
                        className="text-left font-medium text-gray-900 hover:text-gray-700"
                        target={"_blank"}
                        onlyNewTabIconOnHover={true}
                      >
                        {resource.title}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <AssetStatusBadge
                        status={resource.extendedProps?.status}
                        availableToBook={
                          resource.extendedProps?.availableToBook
                        }
                      />
                      <CategoryBadge
                        category={resource.extendedProps?.category}
                      />
                    </div>
                  </div>
                </div>
              )}
              eventContent={renderEventCard}
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
    <div className="absolute inset-0 z-10 flex justify-center bg-white/90">
      <div className="flex flex-col items-center gap-4 pt-[300px]">
        <FallbackLoading className="size-16" />
        <p className="text-sm text-gray-600">Loading calendar...</p>
      </div>
    </div>
  );
}
