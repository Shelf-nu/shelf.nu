export const MAX_SAVED_FILTER_PRESETS = 20;

export const SAVED_FILTER_VIEWS = ["table", "availability"] as const;

export type SavedFilterView = (typeof SAVED_FILTER_VIEWS)[number];
