import { getCurrentSearchParams } from "./http.server";
import { mergeSearchParams } from "./merge-search-params";

export const getParamsValues = (searchParams: URLSearchParams) => ({
  page: Number(searchParams.get("page") || "0"),
  perPage: Number(searchParams.get("per_page") || "8"),
  search: searchParams.get("s") || null,
  categoriesIds: searchParams.getAll("category") || [],
});

/** Generates prev & next links  */
export const generatePageMeta = (request: Request) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, search } = getParamsValues(searchParams);

  let prev = search
    ? mergeSearchParams(searchParams, { page: page - 1 })
    : `?page=${page - 1}`;

  let next = search
    ? mergeSearchParams(searchParams, { page: page >= 1 ? page + 1 : 2 })
    : `?page=${page >= 1 ? page + 1 : 2}`;

  return { prev, next };
};
