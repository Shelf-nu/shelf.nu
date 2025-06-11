import { useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import type { Booking, TeamMember, User } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { ClientOnly } from "remix-utils/client-only";
import EventCard from "~/components/calendar/event-card";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import { Button } from "~/components/shared/button";
import { ButtonGroup } from "~/components/shared/button-group";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { FULL_CALENDAR_LICENSE_KEY } from "~/utils/env";
import { tw } from "~/utils/tw";
import { AssetImage } from "../asset-image";
import { AssetStatusBadge } from "../asset-status-badge";

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

  const disabledButtonStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";

  const { resources, events } = useMemo(() => {
    const resources = items.map((item) => ({
      id: item.id,
      title: item.title,
      extendedProps: {
        mainImage: item.mainImage,
        thumbnailImage: item.thumbnailImage,
        mainImageExpiration: item.mainImageExpiration,
        status: item.status,
        availableToBook: item.availableToBook,
      },
    }));

    const events = items
      .map((asset) => [
        ...asset.bookings.map((b) => {
          const booking = b as Booking & {
            custodianUser?: User;
            custodianTeamMember?: TeamMember;
          };

          const custodianName = booking?.custodianUser
            ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`
            : booking.custodianTeamMember?.name;

          return {
            title: booking.name,
            resourceId: asset.id,
            start: booking.from!,
            end: booking.to!,
            extendedProps: {
              id: b.id,
              name: b.name,
              status: b.status,
              title: b.name,
              description: b.description,
              start: b.from,
              end: b.to,
              custodian: {
                name: custodianName,
                user: booking.custodianUser
                  ? {
                      id: booking.custodianUserId,
                      firstName: booking.custodianUser?.firstName,
                      lastName: booking.custodianUser?.lastName,
                      profilePicture: booking.custodianUser?.profilePicture,
                    }
                  : undefined,
              },
            },
          };
        }),
      ])
      .flat();

    return { resources, events };
  }, [items]);

  function handleNavigation(navigateTo: "prev" | "today" | "next") {
    const calendarApi = calendarRef.current?.getApi();
    if (navigateTo == "prev") {
      calendarApi?.prev();
    } else if (navigateTo == "next") {
      calendarApi?.next();
    } else if (navigateTo == "today") {
      calendarApi?.gotoDate(new Date());
    }

    updateTitle();
  }

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
          <div className="mr-4">
            <ButtonGroup>
              <Button
                variant="secondary"
                className="border-r p-[0.7em] text-gray-500"
                onClick={() => handleNavigation("prev")}
                aria-label="Previous month"
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button
                variant="secondary"
                className="border-r px-3 py-2 text-sm font-semibold text-gray-700"
                onClick={() => handleNavigation("today")}
                tooltip={"Go to today"}
              >
                Today
              </Button>
              <Button
                variant="secondary"
                className="p-[0.7em] text-gray-500"
                onClick={() => handleNavigation("next")}
                aria-label="Next month"
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </ButtonGroup>
          </div>

          {isMd ? (
            <ButtonGroup>
              <Button
                variant="secondary"
                onClick={() => handleViewChange("resourceTimelineMonth")}
                className={tw(
                  calendarView === "resourceTimelineMonth"
                    ? `${disabledButtonStyles}`
                    : ""
                )}
              >
                Month
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleViewChange("resourceTimelineWeek")}
                className={tw(
                  calendarView === "resourceTimelineWeek"
                    ? `${disabledButtonStyles}`
                    : ""
                )}
              >
                Week
              </Button>
              <Button
                variant="secondary"
                onClick={() => handleViewChange("resourceTimelineDay")}
                className={tw(
                  calendarView === "resourceTimelineDay"
                    ? `${disabledButtonStyles}`
                    : ""
                )}
              >
                Day
              </Button>
            </ButtonGroup>
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
            resourceAreaHeaderClassNames={() => [
              "text-md font-semibold text-gray-900",
            ]}
            slotLabelFormat={[
              { month: "long", year: "numeric" }, // top level of text
              { weekday: "short", day: "2-digit" }, // lower level of text
            ]}
            slotLabelClassNames={() => ["font-normal text-gray-600"]}
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
            eventContent={EventCard}
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
