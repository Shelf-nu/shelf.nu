/**
 * Field registry for `/api/model-filters`.
 *
 * This endpoint backs the search box in every `DynamicSelect` /
 * `DynamicDropdown`. It used to run a bare `findMany` with no `select`, then
 * expose each row through three paths at once (`...item`, `metadata: item`,
 * `user`) — so a team-member search returned the whole roster with email
 * addresses to any authenticated org member.
 *
 * One table fixes all three, because it narrows `item` itself rather than the
 * response. It also defines which columns may be searched, closing an
 * arbitrary-column oracle: `queryKey` reached the Prisma `where` unvalidated,
 * so `?queryKey=description` blind-searched text no picker ever displays.
 *
 * A model with no entry here cannot be queried at all — new models are inert
 * until someone adds one and reviews the field list.
 *
 * @see {@link file://./../routes/api+/model-filters.ts}
 */

/** Models the picker search endpoint will serve. */
export type RegisteredModelName =
  | "tag"
  | "category"
  | "location"
  | "kit"
  | "assetModel"
  | "booking"
  | "teamMember";

/** What one model exposes to a picker search. */
type ModelFilterConfig = {
  /**
   * Columns a caller may search on. Every one of the 56 call sites passes
   * `name`; the list exists so a future picker needing a second display column
   * has one reviewed place to declare it, rather than reopening arbitrary
   * column search.
   */
  searchable: readonly string[];
  /** Prisma `select` — the only fields that ever leave the server. */
  select: Record<string, unknown>;
};

/**
 * Every field below is audit-derived from what consumers actually read. The
 * non-obvious ones are reached through `metadata` and would blank silently:
 * `location.thumbnailUrl` (location-select, asset/kit forms, manage-assets),
 * `teamMember.userId` (kits index, qr link kit), `category`/`tag`.`color`
 * (advanced filters), `booking.status`/`from`/`to` (both add-to-booking
 * dialogs).
 *
 * Deliberately excluded: `user.email`, `booking.description`, all timestamps.
 */
export const MODEL_FILTER_REGISTRY: Record<
  RegisteredModelName,
  ModelFilterConfig
> = {
  tag: {
    searchable: ["name"],
    select: { id: true, name: true, color: true },
  },
  category: {
    searchable: ["name"],
    select: { id: true, name: true, color: true },
  },
  location: {
    searchable: ["name"],
    select: { id: true, name: true, thumbnailUrl: true },
  },
  kit: {
    searchable: ["name"],
    select: { id: true, name: true, status: true },
  },
  assetModel: {
    searchable: ["name"],
    select: { id: true, name: true, image: true },
  },
  booking: {
    searchable: ["name"],
    select: {
      id: true,
      name: true,
      status: true,
      from: true,
      to: true,
    },
  },
  teamMember: {
    searchable: ["name"],
    select: {
      id: true,
      name: true,
      userId: true,
      // No `email`: nothing renders it (`resolveTeamMemberName` only appends it
      // when `includeEmail` is passed, and no call site passes it). The server
      // `where` still MATCHES on email, so search-by-email keeps working.
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        },
      },
    },
  },
};

/**
 * Config for one registered model.
 *
 * @param name - Registered model name.
 * @returns That model's searchable keys and Prisma `select`.
 */
export function getModelFilterConfig(
  name: RegisteredModelName
): ModelFilterConfig {
  return MODEL_FILTER_REGISTRY[name];
}

/**
 * Whether a caller-supplied `queryKey` may be searched on a model.
 *
 * @param name - Registered model name.
 * @param key - Caller-supplied `queryKey`.
 * @returns `true` only for columns the registry declares searchable.
 */
export function isSearchableKey(name: RegisteredModelName, key: string) {
  return MODEL_FILTER_REGISTRY[name].searchable.includes(key);
}
