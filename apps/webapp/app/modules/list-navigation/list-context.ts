/**
 * Shared vocabulary for stepping through a list from a detail page.
 *
 * Client-safe: the row links, the header arrows and the neighbours endpoint
 * all read these, so nothing here may import a `*.server` module.
 */

/** The lists a detail page can step through. */
export const LIST_ENTITIES = ["asset", "booking", "kit", "location"] as const;

/** One of {@link LIST_ENTITIES}. */
export type ListEntity = (typeof LIST_ENTITIES)[number];

/** Which list a detail page was opened from. Travels in history state, never in the URL. */
export type ListContext = {
  entity: ListEntity;
  /** The list URL's search string, including page, e.g. "?s=drill&page=2&orderBy=title". */
  search: string;
};

/** A record next to the current one, and the list page it sits on. */
export type NeighbourRef = {
  id: string;
  /** Page the neighbour is on, for the next {@link ListContext}. */
  page: number;
};

/** The records before and after the current one; `null` at an end of the list. */
export type Neighbours = {
  prev: NeighbourRef | null;
  next: NeighbourRef | null;
};

/**
 * The detail page each list's rows open. Asset and booking rows open the
 * overview tab directly: their bare `/:id` routes redirect, and a loader
 * redirect replaces history state, which would drop the list context.
 */
export const LIST_DETAIL_PATH: Record<ListEntity, (id: string) => string> = {
  asset: (id) => `/assets/${id}/overview`,
  booking: (id) => `/bookings/${id}/overview`,
  kit: (id) => `/kits/${id}/assets`,
  location: (id) => `/locations/${id}/assets`,
};

/** Narrows an untrusted string to a {@link ListEntity}. */
export function isListEntity(value: unknown): value is ListEntity {
  return (
    typeof value === "string" &&
    (LIST_ENTITIES as readonly string[]).includes(value)
  );
}

/**
 * Narrows an untrusted history state value to a {@link ListContext}.
 *
 * @param value - Anything read from `location.state`
 * @returns The list context, or `null` when `value` is not one
 */
export function readListContext(value: unknown): ListContext | null {
  if (!value || typeof value !== "object") return null;
  const { entity, search } = value as Record<string, unknown>;
  if (!isListEntity(entity) || typeof search !== "string") return null;
  return { entity, search };
}

/**
 * The list page a search string is on.
 *
 * @param search - A list search string, with or without the leading `?`
 * @returns The `page` param as a positive integer, 1 when absent or invalid
 */
export function readPage(search: string): number {
  const page = Number(new URLSearchParams(search).get("page"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * The same list search string pointed at another page.
 *
 * @param search - A list search string, with or without the leading `?`
 * @param page - The page to point at
 * @returns The search string with `page` replaced, with a leading `?`
 */
export function withPage(search: string, page: number): string {
  const params = new URLSearchParams(search);
  params.set("page", String(page));
  return `?${params.toString()}`;
}
