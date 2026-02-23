import { useLoaderData } from "react-router";
import { useCanUseBookings } from "~/hooks/use-can-use-bookings";
import type { loader } from "~/routes/_layout+/home";
import { PremiumFeatureTeaser } from "./premium-feature-teaser";
import { ClickableTr } from "../dashboard/clickable-tr";
import { DashboardEmptyState } from "../dashboard/empty-state";
import { Button } from "../shared/button";

import { Table, Td } from "../table";

/** Resolve custodian display name from booking data */
function getCustodianName(booking: any): string | null {
  if (booking.custodianTeamMember?.name) {
    return booking.custodianTeamMember.name;
  }
  if (booking.custodianUser) {
    const { firstName, lastName } = booking.custodianUser;
    if (firstName || lastName) {
      return [firstName, lastName].filter(Boolean).join(" ");
    }
  }
  return null;
}

export default function OverdueBookings() {
  const { overdueBookings } = useLoaderData<typeof loader>();
  const canUseBookings = useCanUseBookings();

  return (
    <div className="flex h-full flex-col rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-3 md:px-6">
        <span className="text-[14px] font-semibold text-gray-900">
          Overdue bookings
        </span>
        <div className="flex items-center gap-2">
          {canUseBookings && overdueBookings.length > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {overdueBookings.length}
            </span>
          )}
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
            headline="Never lose track of returns"
            description="Get instant visibility into overdue checkouts and keep your team accountable."
          />
        </div>
      ) : overdueBookings.length > 0 ? (
        <Table className="flex-1">
          <tbody>
            {overdueBookings.map((booking: any) => {
              const custodian = getCustodianName(booking);
              const assetCount = booking._count?.assets ?? 0;
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
                          <span className="font-medium text-error-600">
                            Due{" "}
                            {new Date(booking.to).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
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
            text="No overdue bookings"
            subText="All bookings are on track."
          />
        </div>
      )}
    </div>
  );
}
