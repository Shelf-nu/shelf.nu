import { useFetchers, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import type { Column } from "~/modules/asset-index-settings/helpers";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";

const columnSchema = z.object({
  name: z.string(), // Convert to enum
  visible: z
    .union([z.boolean(), z.string()])
    .transform((val) => val === "on" || val === true) // Convert "on" to boolean true
    .default(false), // if not present in the formData, convert to false. That means the checkbox was unselected
  position: z.number().or(z.string().transform(Number)),
});
const columnsSchema = z.array(columnSchema);

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
  const validatedColumns = columnsSchema.parse(columns);

  return validatedColumns as Column[];
};

/** Hook that returns the columns in the asset index.
 * Can only be used in asset index page or its child routes
 */
export function useAssetIndexColumns() {
  const { settings } = useLoaderData<AssetIndexLoaderData>();

  /** Get the mode from the settings */
  const columns = settings?.columns as Column[];

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

  return optimisticColumns;
}
