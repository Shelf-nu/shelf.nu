import { useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import { useLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import { CalendarNavigation } from "~/components/calendar/calendar-navigation";
import renderEventCard from "~/components/calendar/event-card";
import { ViewButtonGroup } from "~/components/calendar/view-button-group";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import { Button } from "~/components/shared/button";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import {
  getStatusClasses,
  handleEventMouseEnter,
  handleEventMouseLeave,
  isOneDayEvent,
} from "~/utils/calendar";
import { FULL_CALENDAR_LICENSE_KEY } from "~/utils/env";
import { AssetImage } from "../asset-image";
import { AssetStatusBadge } from "../asset-status-badge";
import { useAssetAvailabilityData } from "./use-asset-availability-data";

export default function AssetsAvailability() {
  const { items, modelName, totalItems, perPage } =
    useLoaderData<AssetIndexLoaderData>();
  const { singular, plural } = modelName;
  const calendarRef = useRef<FullCalendar>(null);
  const { isMd } = useViewportHeight();
  const [calendarTitle, setCalendarTitle] = useState<string>();
  const [calendarView, setCalendarView] = useState(
    isMd ? "resourceTimelineMonth" : "resourceTimelineWeek"
  );
  const { resources, events } = useAssetAvailabilityData();

  function handleViewChange(view: string) {
    setCalendarView(view);
    const calendarApi = calendarRef.current?.getApi();
    calendarApi?.changeView(view);

    updateTitle();
  }

  function updateTitle() {
    const calendarApi = calendarRef.current?.getApi();
    if (calendarApi) {
      setCalendarTitle(calendarApi.view.title);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 rounded-t-md border bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <h3>{calendarTitle ?? calendarRef?.current?.getApi()?.view.title}</h3>
        </div>

        <div className="flex items-center">
          <CalendarNavigation
            calendarRef={calendarRef}
            updateTitle={updateTitle}
          />

          {isMd ? (
            <>
              <ViewButtonGroup
                views={[
                  { label: "Month", value: "resourceTimelineMonth" },
                  { label: "Week", value: "resourceTimelineWeek" },
                  { label: "Day", value: "resourceTimelineDay" },
                ]}
                currentView={calendarView}
                onViewChange={handleViewChange}
              />
            </>
          ) : null}
        </div>
      </div>

      <ClientOnly fallback={<FallbackLoading className="size-36" />}>
        {() => (
          <FullCalendar
            ref={calendarRef}
            height="auto"
            timeZone="local"
            slotEventOverlap
            nowIndicator
            eventTimeFormat={{
              hour: "numeric",
              minute: "2-digit",
              meridiem: "short",
            }}
            eventMouseEnter={handleEventMouseEnter("resourceTimelineMonth")}
            eventMouseLeave={handleEventMouseLeave("resourceTimelineMonth")}
            resourceOrder="none"
            plugins={[resourceTimelinePlugin]}
            schedulerLicenseKey={FULL_CALENDAR_LICENSE_KEY}
            initialView="resourceTimelineMonth"
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
                      <span className="text-gray-400">out of {totalItems}</span>
                    </p>
                  ) : (
                    <span>
                      {totalItems} {items.length > 1 ? plural : singular}
                    </span>
                  )}
                </div>
              </div>
            }
            resourceAreaHeaderClassNames="text-md font-semibold text-gray-900"
            slotLabelFormat={[
              { month: "long", year: "numeric" }, // top level of text
              { weekday: "short", day: "2-digit" }, // lower level of text
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
                  <AssetStatusBadge
                    status={resource.extendedProps?.status}
                    availableToBook={resource.extendedProps?.availableToBook}
                  />
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
          />
        )}
      </ClientOnly>
    </div>
  );
}
