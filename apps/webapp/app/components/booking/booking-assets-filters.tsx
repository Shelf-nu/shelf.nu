import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { BOOKING_ASSET_SORTING_OPTIONS } from "~/modules/booking/constants";

export function BookingAssetsFilters() {
  // const { booking } = useLoaderData<BookingPageLoaderData>();
  // const [, setSearchParams] = useSearchParams();

  // // Only show status filter for ongoing bookings (ONGOING or OVERDUE)
  // const shouldShowStatusFilter =
  //   booking.status === BookingStatus.ONGOING ||
  //   booking.status === BookingStatus.OVERDUE;

  // // Custom handler for status changes in ongoing bookings
  // const handleStatusChange = (value: string) => {
  //   setSearchParams((prev) => {
  //     prev.set("status", value);
  //     return prev;
  //   });
  // };

  return (
    <Filters
      slots={{
        // "left-of-search": shouldShowStatusFilter ? (
        //   <StatusFilter
        //     statusItems={{
        //       [AssetStatus.AVAILABLE]: AssetStatus.AVAILABLE,
        //       [AssetStatus.CHECKED_OUT]: AssetStatus.CHECKED_OUT,
        //     }}
        //     name="status"
        //     defaultValue={AssetStatus.CHECKED_OUT}
        //     onValueChange={handleStatusChange}
        //   />
        // ) : undefined,
        "right-of-search": (
          <SortBy
            sortingOptions={BOOKING_ASSET_SORTING_OPTIONS}
            defaultSortingBy="status"
            defaultSortingDirection="desc"
            hint={
              <div className="text-xs">
                <p>
                  <strong>Status</strong> keeps items still to check out on top
                  and moves checked-out items to the bottom, so you can focus on
                  what's left.
                </p>
                <p className="mt-1">
                  <strong>Item type</strong> groups kits first, then individual
                  assets.
                </p>
              </div>
            }
          />
        ),
      }}
    />
  );
}
