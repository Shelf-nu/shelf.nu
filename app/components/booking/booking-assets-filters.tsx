import { Filters } from "~/components/list/filters";

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
    // slots={{
    //   "left-of-search": shouldShowStatusFilter ? (
    //     <StatusFilter
    //       statusItems={{
    //         [AssetStatus.AVAILABLE]: AssetStatus.AVAILABLE,
    //         [AssetStatus.CHECKED_OUT]: AssetStatus.CHECKED_OUT,
    //       }}
    //       name="status"
    //       defaultValue={AssetStatus.CHECKED_OUT}
    //       onValueChange={handleStatusChange}
    //     />
    //   ) : undefined,
    // }}
    />
  );
}
