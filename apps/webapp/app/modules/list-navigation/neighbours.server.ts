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
 * Each id counts once, at its first position: the pages load in separate
 * queries, so a row created or removed between them can repeat an id across
 * a page boundary, and a repeat must never make a record its own neighbour.
 *
 * @param pages - Consecutive pages in ascending page order
 * @param id - The current record
 * @returns Both neighbours with the page each sits on; both `null` when `id`
 *   is not on any of the pages (the list changed, or the context is stale)
 */
export function pickNeighbours(pages: ListPage[], id: string): Neighbours {
  const seen = new Set<string>();
  const rows = pages
    .flatMap(({ page, ids }) => ids.map((rowId) => ({ id: rowId, page })))
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  const index = rows.findIndex((row) => row.id === id);
  if (index === -1) return { prev: null, next: null };
  return { prev: rows[index - 1] ?? null, next: rows[index + 1] ?? null };
}

/**
 * Finds the records next to `id` in the list the user opened it from.
 *
 * Loads the list's page through the list's own query function, and a page
 * either side only when it is needed: the previous page when `id` is the
 * first row, the next page when it is the last row, and both when `id` is
 * not on its page at all (a row created or removed since the list loaded can
 * push it across a boundary).
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
  const fetchPageIds = await createPageFetcher({ request, filters, caller });

  async function loadPage(pageNumber: number): Promise<ListPage> {
    const search = withPage(filters, pageNumber);
    const listRequest = new Request(`${origin}${indexPath}${search}`, {
      headers: request.headers,
    });
    const ids = await fetchPageIds({ listRequest, filters: search.slice(1) });
    return { page: pageNumber, ids };
  }

  const current = await loadPage(page);
  const position = current.ids.indexOf(id);
  const needsPrevious = page > 1 && position <= 0;
  const needsNext = position === -1 || position === current.ids.length - 1;

  const [previous, next] = await Promise.all([
    needsPrevious ? loadPage(page - 1) : null,
    needsNext ? loadPage(page + 1) : null,
  ]);

  return pickNeighbours(
    [previous, current, next].filter((p): p is ListPage => p !== null),
    id
  );
}
