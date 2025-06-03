import { useMemo, useRef } from "react";
import FullCalendar from "@fullcalendar/react";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import { useLoaderData } from "@remix-run/react";
import { ClientOnly } from "remix-utils/client-only";
import FallbackLoading from "~/components/dashboard/fallback-loading";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

export default function AssetsAvailability() {
  const { items } = useLoaderData<AssetIndexLoaderData>();
  const calendarRef = useRef<FullCalendar>(null);

  const test = useMemo(() => {
    const resources = items.map((item) => ({ id: item.id, title: item.title }));

    const events = items.flatMap((item) => item.bookings);

    console.log(events);
  }, [items]);

  return (
    <ClientOnly fallback={<FallbackLoading className="size-36" />}>
      {() => (
        <FullCalendar
          ref={calendarRef}
          plugins={[resourceTimelinePlugin]}
          schedulerLicenseKey="GPL-My-Project-Is-Open-Source"
          initialView="resourceTimelineMonth"
          headerToolbar={false}
          resources={items}
          resourceAreaHeaderContent="Assets"
          resourceLabelContent={({ resource }) => (
            <div className="p-2">{resource.title}</div>
          )}
        />
      )}
    </ClientOnly>
  );
}
