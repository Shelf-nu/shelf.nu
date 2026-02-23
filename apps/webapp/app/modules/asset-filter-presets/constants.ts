/** Maximum number of saved filter presets per user per organization */
export const MAX_SAVED_FILTER_PRESETS = 20;

/** Valid view types for saved presets */
export const SAVED_FILTER_VIEWS = ["table", "availability"] as const;
export type SavedFilterView = (typeof SAVED_FILTER_VIEWS)[number];
