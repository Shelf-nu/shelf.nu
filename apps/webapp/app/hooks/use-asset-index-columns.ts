import { useFetchers, useLoaderData } from "react-router";
import { z } from "zod";
import { useAssetIndexSettingsOverrides } from "~/context/asset-index-settings-context";
import type { Column } from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

/**
 * Simplified schema for parsing form data during optimistic updates
 * This is a subset of the full column validation schema from helpers.ts
 * Used only for transforming form data before the server validates the complete structure
 */
const formParsingSchema = z.object({
  name: z.string(),
  visible: z
    .union([z.boolean(), z.string()])
    .transform((val) => val === "on" || val === true)
    .default(false),
  position: z.number().or(z.string().transform(Number)),
});

const columnsFormSchema = z.array(formParsingSchema);

const parseColumnsFromFormData = (formData: FormData): Column[] => {
  const columns: Partial<Column>[] = [];

  for (const [key, value] of formData.entries()) {
    const match = key.match(/^columns\[(\d+)\]\[([^_]+)\]$/);
    if (match) {
      const index = parseInt(match[1]);
      const field = match[2] as keyof Column; // Assert field to be a key of Column

      if (!columns[index]) {
        columns[index] = { position: index }; // Initialize with position
      }

      // @ts-expect-error
      columns[index][field] = value; // Direct assignment for other fields
    }
  }

  // Validate with Zod
  const validatedColumns = columnsFormSchema.parse(columns);

  return validatedColumns as Column[];
};

/** Hook that returns the columns in the asset index.
 * Can only be used in asset index page or its child routes.
 *
 * A mounted `AssetIndexSettingsProvider` overriding `columns` wins over the
 * loader's stored value and the optimistic fetcher update below — this is
 * how the drill-down sheet can render its own column set without touching
 * the page's saved settings.
 */
export function useAssetIndexColumns() {
  const overrides = useAssetIndexSettingsOverrides();
  const { settings } = useLoaderData<AssetIndexLoaderData>();

  /** Get the mode from the settings */
  const columns = (settings?.columns as Column[]) || [];

  let optimisticColumns = columns;
  const fetchers = useFetchers();
  /** Find the fetcher used for toggling between asset index modes */
  const columnsFetcher = fetchers.find(
    (fetcher) => fetcher.key === "asset-index-settings-columns"
  );

  if (columnsFetcher?.formData) {
    // Usage in your hook
    optimisticColumns = columnsFetcher?.formData
      ? parseColumnsFromFormData(columnsFetcher.formData)
      : [];
  }

  // Checked last, after every hook above has run in a stable order: an
  // early return here would change the hook call order between renders.
  if (overrides?.columns !== undefined) {
    return overrides.columns;
  }

  return optimisticColumns;
}
