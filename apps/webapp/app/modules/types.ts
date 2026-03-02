/**
 * Pass this type to useLoaderData when fetching data from an index response which includes search/filter
 */

export interface SearchableIndexResponse {
  /** The search string */
  search?: string;

  /** The name of the model of the data being filtered/searched */
  modelName: { singular: string; plural: string };

  /** Label for the search field */
  searchFieldLabel?: string;

  /** Tooltip for the search field */
  searchFieldTooltip?: {
    title: string;
    text: string; // Supports markdown
  };

  /** Whether the current request has active column/advanced filters */
  hasActiveFilters?: boolean;
}

export type RouteHandleWithName = {
  name?: string;
  [key: string]: any;
};
