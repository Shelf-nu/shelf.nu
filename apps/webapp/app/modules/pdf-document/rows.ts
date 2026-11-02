/**
 * PDF Document Rows
 *
 * The layout decisions of a booking document that are not markup: which columns
 * print and how wide each one is, and how the asset rows group. Kept pure so
 * the renderer stays a plain map over these results and the rules are tested
 * on their own.
 *
 * @see {@link file://../../components/booking/booking-overview-pdf.tsx}
 */
import type { BookingDocumentConfig, DocumentOptionalColumn } from "./config";

/**
 * Width, in percent of the table, of the columns whose content has a fixed
 * size: a row number, a photo of `size-14`, a quantity. They keep it on every
 * document, so a photo is never squeezed and a number never spills.
 */
const FIXED_PERCENT = { number: 5, image: 10, quantity: 6 } as const;

/**
 * Width, in percent of the table, each text column asks for. Text columns
 * share what Code and the fixed columns leave, in proportion to these.
 */
const TEXT_PERCENT = { name: 16, kit: 10, category: 13, location: 13 } as const;

/** Width, in percent of the table, each custom field column asks for. */
const CUSTOM_FIELD_PERCENT = 14;

/** One printed column: a built-in one, or a custom field by its id. */
export type DocumentColumn =
  | { kind: "number" | "name" | "code"; percent: number }
  | { kind: DocumentOptionalColumn; percent: number }
  | { kind: "customField"; customFieldId: string; percent: number };

/**
 * The columns a document prints, in their fixed order, with their widths.
 *
 * `#`, Name and Code always print. Code keeps exactly `codePercent`, the share
 * its barcode picture is sized for. `#`, Image and Qty keep their own fixed
 * widths. The text columns (Name, Kit, Category, Location and custom fields)
 * share the rest in proportion to the width each asks for. With every
 * built-in column on and no custom field, each column keeps its own width.
 *
 * @param params.config - The document's switches
 * @param params.customFieldIds - The custom fields that print as columns, in
 *   order
 * @param params.codePercent - The Code column's share of the table
 * @returns The columns, whose percents add up to 100
 */
export function documentColumns({
  config,
  customFieldIds,
  codePercent,
}: {
  config: BookingDocumentConfig;
  customFieldIds: string[];
  codePercent: number;
}): DocumentColumn[] {
  const { columns } = config;
  /** Marks a column whose width is shared with the other text columns. */
  const text = <T extends DocumentColumn>(column: T) => ({
    column,
    shared: true,
  });
  const fixed = <T extends DocumentColumn>(column: T) => ({
    column,
    shared: false,
  });

  const planned = [
    fixed({ kind: "number", percent: FIXED_PERCENT.number }),
    ...(columns.image
      ? [fixed({ kind: "image", percent: FIXED_PERCENT.image })]
      : []),
    text({ kind: "name", percent: TEXT_PERCENT.name }),
    ...(columns.quantity
      ? [fixed({ kind: "quantity", percent: FIXED_PERCENT.quantity })]
      : []),
    ...(["kit", "category", "location"] as const)
      .filter((key) => columns[key])
      .map((key) => text({ kind: key, percent: TEXT_PERCENT[key] })),
    ...customFieldIds.map((customFieldId) =>
      text({
        kind: "customField",
        customFieldId,
        percent: CUSTOM_FIELD_PERCENT,
      })
    ),
  ];

  const sum = (shared: boolean) =>
    planned
      .filter((p) => p.shared === shared)
      .reduce((total, p) => total + p.column.percent, 0);
  const textShare = 100 - codePercent - sum(false);
  const textAsked = sum(true);

  return [
    ...planned.map(({ column, shared }) =>
      shared
        ? { ...column, percent: (column.percent * textShare) / textAsked }
        : column
    ),
    { kind: "code", percent: codePercent },
  ];
}

/** The category a row groups under when it has none. */
export const UNCATEGORIZED_GROUP = "Uncategorized";

/** A run of rows under one group header. `name` is null when not grouped. */
export type DocumentRowGroup<T> = { name: string | null; rows: T[] };

/**
 * Splits the rows into the groups the document prints.
 *
 * Not grouped: one group, rows in the order given. By category: one group per
 * category, groups A to Z with uncategorized rows last, and the rows of a
 * group in the order given. A kit's members can sit in different categories,
 * so a kit can appear in more than one group; each row keeps its kit name.
 *
 * @param rows - The rows, already sorted
 * @param groupBy - The document's grouping
 * @returns The groups, in print order
 */
export function groupDocumentRows<
  T extends { category?: { name: string } | null },
>(rows: T[], groupBy: BookingDocumentConfig["groupBy"]): DocumentRowGroup<T>[] {
  if (groupBy === "none") return [{ name: null, rows }];

  // Keyed on the category's name, with `null` for rows without one, so a
  // category that is itself called "Uncategorized" stays its own group.
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = row.category?.name?.trim() || null;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    })
    .map(([key, groupRows]) => ({
      name: key ?? UNCATEGORIZED_GROUP,
      rows: groupRows,
    }));
}
