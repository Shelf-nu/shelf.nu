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

export default function AssetsAvailability() {
  const { items } = useLoaderData<AssetIndexLoaderData>();
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
      mainImage: item.mainImage,
      thumbnailImage: item.thumbnailImage,
      mainImageExpiration: item.mainImageExpiration,
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
            resourceAreaHeaderContent="Assets"
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
                  className="size-10 rounded border object-cover"
                  withPreview
                />

                <p>{resource.title}</p>
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
