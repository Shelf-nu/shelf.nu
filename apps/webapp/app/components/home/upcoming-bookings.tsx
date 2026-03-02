import { useLoaderData } from "react-router";
import { useCanUseBookings } from "~/hooks/use-can-use-bookings";
import type { loader } from "~/routes/_layout+/home";
import { getBookingCustodianName } from "~/utils/bookings";
import { PremiumFeatureTeaser } from "./premium-feature-teaser";
import { ClickableTr } from "../dashboard/clickable-tr";
import { DashboardEmptyState } from "../dashboard/empty-state";
import { Button } from "../shared/button";
import { DateS } from "../shared/date";

import { Table, Td } from "../table";

type BookingItem = ReturnType<
  typeof useLoaderData<typeof loader>
>["upcomingBookings"][number];

export default function UpcomingBookings() {
  const { upcomingBookings } = useLoaderData<typeof loader>();
  const canUseBookings = useCanUseBookings();

  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-gray-900">
          Upcoming bookings
        </span>
        <div className="flex items-center gap-2">
          {canUseBookings && (
            <Button
              to="/bookings"
              variant="block-link-gray"
              className="!mt-0 text-xs"
            >
              View all
            </Button>
          )}
        </div>
      </div>
      {!canUseBookings ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <PremiumFeatureTeaser
            headline="Schedule & track checkouts"
            description="Reserve assets ahead of time and never double-book equipment again."
          />
        </div>
      ) : upcomingBookings.length > 0 ? (
        <Table className="flex-1">
          <tbody>
            {upcomingBookings.map((booking: BookingItem) => {
              const custodian = getBookingCustodianName(booking);
              const assetCount =
                (booking as BookingItem & { _count?: { assets?: number } })
                  ._count?.assets ?? 0;

              return (
                <ClickableTr key={booking.id} to={`/bookings/${booking.id}`}>
                  <Td className="w-full">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Button
                          to={`/bookings/${booking.id}`}
                          variant="link"
                          className="truncate text-left text-sm font-medium text-gray-900 hover:text-gray-700"
                        >
                          {booking.name}
                        </Button>
                        <span className="text-xs text-gray-500">
                          {custodian && (
                            <>
                              <span className="font-medium text-gray-700">
                                {custodian}
                              </span>
                              {" · "}
                            </>
                          )}
                          {assetCount > 0 && (
                            <>
                              {assetCount} asset{assetCount !== 1 ? "s" : ""}
                              {" · "}
                            </>
                          )}
                          <DateS
                            date={booking.from}
                            options={{ month: "short", day: "numeric" }}
                          />{" "}
                          →{" "}
                          <DateS
                            date={booking.to}
                            options={{ month: "short", day: "numeric" }}
                          />
                        </span>
                      </div>
                    </div>
                  </Td>
                </ClickableTr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <div className="flex flex-1 items-center justify-center p-4">
          <DashboardEmptyState
            text="No planned bookings"
            subText="Bookings with Reserved status will appear here."
            ctaTo="/bookings/new"
            ctaText="Create a booking"
          />
        </div>
      )}
    </div>
  );
}
