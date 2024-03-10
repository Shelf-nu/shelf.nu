import type { BookingStatus } from "@prisma/client";

export const getParamsValues = (searchParams: URLSearchParams) => ({
  page: Number(searchParams.get("page") || "1"),
  perPageParam: Number(searchParams.get("per_page") || 0),
  search: searchParams.get("s") || null,
  categoriesIds: searchParams.getAll("category") || [],
  tagsIds: searchParams.getAll("tag") || [],
  bookingFrom: searchParams.get("bookingFrom")?.length
    ? new Date(searchParams.get("bookingFrom") as string)
    : null,
  bookingTo: searchParams.get("bookingTo")?.length
    ? new Date(searchParams.get("bookingTo") as string)
    : null,
  hideUnavailable: searchParams.get("hideUnavailable")?.length
    ? searchParams.get("hideUnavailable") == "true"
    : undefined,
  unhideAssetsBookigIds: searchParams.getAll("unhideAssetsBookigIds") || [],

  status:
    searchParams.get("status") === "ALL" // If the value is "ALL", we just remove the param
      ? null
      : (searchParams.get("status") as BookingStatus | null),
});
