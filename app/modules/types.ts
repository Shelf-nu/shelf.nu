export type WithDateFields<T, DateType> = {
  [K in keyof T]: K extends "createdAt" | "updatedAt" ? DateType : T[K];
};

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
    text: string;
  };
}

export type RouteHandleWithName = {
  name?: string;
  [key: string]: any;
};
