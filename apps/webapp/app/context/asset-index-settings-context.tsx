/**
 * Asset Index Settings Overrides
 *
 * Lets a subtree render advanced-index rows under different display settings
 * than the page's stored ones — the drill-down sheet turns the frozen name
 * column off, because freezing is anchored to a bulk-select column the sheet
 * does not have.
 *
 * Absent by default: with no provider mounted the settings hooks read the
 * asset index loader exactly as before, so the index itself is unaffected.
 *
 * @see {@link file://../hooks/use-asset-index-columns.ts}
 * @see {@link file://../hooks/use-asset-index-freeze-column.ts}
 */
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { Column } from "~/modules/asset-index-settings/helpers";

/**
 * The subset of asset-index display settings a subtree can override.
 *
 * Covers `columns` and `freezeColumn`: the settings a subtree can genuinely
 * render differently. Every other asset-index setting reads the loader
 * directly, and none belongs here until a caller needs to override it — a key
 * declared here that no hook consults would typecheck, run, and do nothing.
 */
export type AssetIndexSettingsOverrides = {
  columns?: Column[];
  freezeColumn?: boolean;
};

const AssetIndexSettingsContext =
  createContext<AssetIndexSettingsOverrides | null>(null);

/**
 * Overrides the asset-index display settings for everything rendered inside.
 *
 * Settings arrive as individual props rather than one object so the memo below
 * can depend on each by value. A caller may therefore pass them inline without
 * rebuilding the context value — and adding a new setting is a signature
 * change the exhaustive-deps rule checks, instead of a dependency array that
 * silently goes stale.
 *
 * Every prop is optional; anything omitted falls through to the setting stored
 * on the asset index loader.
 *
 * @param columns - Column set to render, overriding the user's stored columns.
 * @param freezeColumn - Whether the name column is sticky. Pass `false` where
 *   there is no bulk-select column for it to anchor against.
 */
export function AssetIndexSettingsProvider({
  columns,
  freezeColumn,
  children,
}: AssetIndexSettingsOverrides & { children: ReactNode }) {
  const value = useMemo(
    () => ({ columns, freezeColumn }),
    [columns, freezeColumn]
  );

  return (
    <AssetIndexSettingsContext.Provider value={value}>
      {children}
    </AssetIndexSettingsContext.Provider>
  );
}

/** Returns the active overrides, or `null` when no provider is mounted. */
export function useAssetIndexSettingsOverrides() {
  return useContext(AssetIndexSettingsContext);
}
