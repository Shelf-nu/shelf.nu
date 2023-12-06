import { getCurrentSearchParams } from "./http.server";
import { mergeSearchParams } from "./merge-search-params";

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
});

/** Generates prev & next links  */
export const generatePageMeta = (request: Request) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, search, categoriesIds, tagsIds } =
    getParamsValues(searchParams);
  const isFiltering = search || categoriesIds || tagsIds;

  let prev = isFiltering
    ? mergeSearchParams(searchParams, { page: page - 1 })
    : `?page=${page - 1}`;

  let next = isFiltering
    ? mergeSearchParams(searchParams, { page: page >= 1 ? page + 1 : 2 })
    : `?page=${page >= 1 ? page + 1 : 2}`;

  return { prev, next };
};
