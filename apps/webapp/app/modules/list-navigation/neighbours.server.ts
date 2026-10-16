/**
 * Finds the records before and after one record in the list a detail page
 * was opened from, for `GET /api/list-neighbours`.
 */
import type { ListEntity, Neighbours } from "./list-context";
import { readPage, withPage } from "./list-context";
import type { ListNavigationCaller } from "./registry.server";
import { LIST_NAVIGATION_REGISTRY } from "./registry.server";

/** The ids on one list page, in list order. */
export type ListPage = { page: number; ids: string[] };

/**
 * The records before and after `id` across consecutive list pages.
 *
 * @param pages - Consecutive pages in ascending page order
 * @param id - The current record
 * @returns Both neighbours with the page each sits on; both `null` when `id`
 *   is not on any of the pages (the list changed, or the context is stale)
 */
export function pickNeighbours(pages: ListPage[], id: string): Neighbours {
  const rows = pages.flatMap(({ page, ids }) =>
    ids.map((rowId) => ({ id: rowId, page }))
  );
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return { prev: null, next: null };
  return { prev: rows[index - 1] ?? null, next: rows[index + 1] ?? null };
}

/**
 * Finds the records next to `id` in the list the user opened it from.
 *
 * Loads the list's page, plus the pages either side so the first and last
 * rows still have a neighbour, through the list's own query function.
 *
 * @param entity - Which list
 * @param id - The current record
 * @param filters - The list's search string, without the leading `?`
 * @param request - The incoming request, whose headers (cookies, client hints)
 *   the list query reads like the index loader does
 * @param caller - The caller, as `requirePermission` resolved them
 */
export async function getListNeighbours({
  entity,
  id,
  filters,
  request,
  caller,
}: {
  entity: ListEntity;
  id: string;
  filters: string;
  request: Request;
  caller: ListNavigationCaller;
}): Promise<Neighbours> {
  const { indexPath, createPageFetcher } = LIST_NAVIGATION_REGISTRY[entity];
  const page = readPage(filters);
  const origin = new URL(request.url).origin;
  const pageNumbers = [page - 1, page, page + 1].filter((p) => p >= 1);
  const fetchPageIds = await createPageFetcher({ request, filters, caller });

  const pages = await Promise.all(
    pageNumbers.map(async (pageNumber) => {
      const search = withPage(filters, pageNumber);
      const listRequest = new Request(`${origin}${indexPath}${search}`, {
        headers: request.headers,
      });
      const ids = await fetchPageIds({
        listRequest,
        filters: search.slice(1),
      });
      return { page: pageNumber, ids };
    })
  );

  return pickNeighbours(pages, id);
}
