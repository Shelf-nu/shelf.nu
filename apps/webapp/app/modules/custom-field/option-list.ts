/**
 * Option List
 *
 * The editable choices of an OPTION custom field, as the settings builder holds
 * them before Save. Each choice is a row, not a string: legacy data holds
 * duplicate options (even exact ones), so a row is identified by a client `key`
 * and remembers the saved spelling it came from in `original`.
 *
 * Everything the form submits is derived from the rows: the final option order,
 * and the rename pairs that tell the server which saved spelling's assets now
 * belong to which final option. `updateCustomField` re-validates every pair.
 *
 * @see {@link file://./../../components/forms/option-builder.tsx}
 * @see {@link file://./service.server.ts} updateCustomField
 */
import { generateClientId } from "~/utils/id/client-id";

/** One choice in the builder. */
export type OptionRow = {
  /** Stable client id. Never the value, because duplicates share a value. */
  key: string;
  value: string;
  /** The saved spelling this row came from, or null for an option added in this edit. */
  original: string | null;
};

/** A saved spelling whose row was merged away, and the row that now holds its assets. */
export type MergedOption = { original: string; intoKey: string };

/** Assets storing `from` are rewritten to `to` when the field is saved. */
export type OptionRename = { from: string; to: string };

/** How many assets a row holds once the field is saved. */
export type OptionUsage = {
  /** Assets that will store this row's value. */
  assets: number;
  /** Of those, the assets whose stored value changes on save (renamed or merged in). */
  updating: number;
};

export type OptionListState = {
  rows: OptionRow[];
  merged: MergedOption[];
  /** The row order before the last Sort A-Z. Undo restores it until the next edit. */
  beforeSort: OptionRow[] | null;
};

export type OptionListAction =
  | { type: "add"; key: string; value: string }
  | { type: "remove"; key: string }
  | { type: "rename"; key: string; value: string }
  | { type: "reorder"; rows: OptionRow[] }
  | { type: "sort" }
  | { type: "undoSort" }
  | { type: "mergeDuplicates" };

/** What committing a rename should do with the typed text. */
export type OptionRenameResolution =
  | { status: "rename"; value: string }
  | { status: "error"; message: string };

const collator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/**
 * The identity two options share when an operator would read them as the same
 * choice: case, surrounding space and repeated inner space do not count.
 */
export function normalizeOptionKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

/**
 * Sorts rows A-Z the way a person reads them: case-insensitive, accents folded,
 * numbers by value ("Item 2" before "Item 10"). Stable, so rows that compare
 * equal keep their relative order.
 */
export function sortOptionsAlphabetically(rows: OptionRow[]): OptionRow[] {
  return [...rows].sort((a, b) =>
    collator.compare(a.value.trim(), b.value.trim())
  );
}

/**
 * Rows an operator would read as the same choice, grouped by
 * {@link normalizeOptionKey}. Only groups with more than one row are returned,
 * in the order their first row appears.
 */
export function findDuplicateGroups(rows: OptionRow[]): OptionRow[][] {
  const groups = new Map<string, OptionRow[]>();
  for (const row of rows) {
    const key = normalizeOptionKey(row.value);
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * Collapses every duplicate group onto its first row, which keeps its spelling
 * and position.
 *
 * @returns The remaining rows, and each removed row with the key of the row it
 *   merged into.
 */
export function mergeDuplicates(rows: OptionRow[]): {
  rows: OptionRow[];
  removed: { row: OptionRow; intoKey: string }[];
} {
  const removed = findDuplicateGroups(rows).flatMap(([kept, ...others]) =>
    others.map((row) => ({ row, intoKey: kept.key }))
  );
  const removedKeys = new Set(removed.map(({ row }) => row.key));
  return { rows: rows.filter((row) => !removedKeys.has(row.key)), removed };
}

/**
 * Which row ends up holding each saved spelling's assets.
 *
 * A row holds the spelling it came from, and a merged-away row's spelling goes
 * to the row it merged into. Exact legacy duplicates share one spelling: a
 * copy that still reads as that spelling keeps it, otherwise the first copy in
 * display order takes it. A spelling whose row was removed without merging
 * maps nowhere, so its assets keep their stored value.
 *
 * A spelling that is still one of the options keeps its assets, unless the
 * assets of another spelling move onto it (a swap or rotation). This is the
 * rule `updateCustomField` enforces, so a save never sends a rename the server
 * refuses.
 */
function assignSavedOptions(
  rows: OptionRow[],
  merged: MergedOption[]
): Map<string, OptionRow> {
  const assignments = new Map<string, OptionRow>();
  for (const row of rows) {
    if (
      row.original !== null &&
      row.value === row.original &&
      !assignments.has(row.original)
    ) {
      assignments.set(row.original, row);
    }
  }
  for (const row of rows) {
    if (row.original !== null && !assignments.has(row.original)) {
      assignments.set(row.original, row);
    }
  }
  const rowsByKey = new Map(rows.map((row) => [row.key, row]));
  for (const { original, intoKey } of merged) {
    const target = rowsByKey.get(intoKey);
    if (target && !assignments.has(original)) {
      assignments.set(original, target);
    }
  }

  // Dropping one move can leave another without the swap that justified it,
  // so repeat until nothing changes. Each pass only removes, so it ends.
  const values = new Set(rows.map((row) => row.value));
  let dropped = true;
  while (dropped) {
    dropped = false;
    const targets = new Set(
      [...assignments]
        .filter(([from, row]) => from !== row.value)
        .map(([, row]) => row.value)
    );
    for (const [from, row] of [...assignments]) {
      if (from !== row.value && values.has(from) && !targets.has(from)) {
        assignments.delete(from);
        dropped = true;
      }
    }
  }
  return assignments;
}

/**
 * The value rewrites a save must apply so every asset follows its option
 * through renames and merges. Spellings that stay the same need no rewrite.
 *
 * @param rows - The final rows, in display order
 * @param merged - Saved spellings removed by "Merge duplicates"
 * @returns One pair per saved spelling whose assets change value
 */
export function buildOptionRenames(
  rows: OptionRow[],
  merged: MergedOption[]
): OptionRename[] {
  return [...assignSavedOptions(rows, merged)]
    .filter(([from, row]) => from !== row.value)
    .map(([from, row]) => ({ from, to: row.value }));
}

/**
 * How many assets each row will hold after save, from the per-spelling counts
 * the loader returns.
 *
 * Besides the spellings assigned to it, a row also picks up assets storing
 * exactly its value when no row claims that spelling: an option deleted and
 * typed again still matches the assets that kept the old string.
 *
 * @param counts - Assets per stored spelling
 * @returns Usage per row key
 */
export function summarizeOptionUsage(
  rows: OptionRow[],
  merged: MergedOption[],
  counts: Record<string, number>
): Map<string, OptionUsage> {
  const assignments = assignSavedOptions(rows, merged);
  const usage = new Map<string, OptionUsage>(
    rows.map((row) => [
      row.key,
      {
        assets: assignments.has(row.value) ? 0 : counts[row.value] ?? 0,
        updating: 0,
      },
    ])
  );
  for (const [from, row] of assignments) {
    const entry = usage.get(row.key);
    const count = counts[from] ?? 0;
    if (entry) {
      entry.assets += count;
      if (from !== row.value) entry.updating += count;
    }
  }
  return usage;
}

/**
 * Decides whether typed text can become the new name of the row `key`.
 * Trimmed like a new option; refused when blank or when another row already
 * reads as the same choice.
 */
export function resolveOptionRename(
  rows: OptionRow[],
  key: string,
  raw: string
): OptionRenameResolution {
  const value = raw.trim();
  if (!value) {
    return { status: "error", message: "Option cannot be empty" };
  }
  const normalized = normalizeOptionKey(value);
  if (
    rows.some(
      (row) => row.key !== key && normalizeOptionKey(row.value) === normalized
    )
  ) {
    return { status: "error", message: "Option already exists" };
  }
  return { status: "rename", value };
}

/** Builder state for a field whose saved options are `options`. */
export function createOptionListState(options: string[]): OptionListState {
  return {
    rows: options.map((value) => ({
      key: generateClientId(),
      value,
      original: value,
    })),
    merged: [],
    beforeSort: null,
  };
}

/** Every edit the option builder makes. Only `sort` keeps an undo point. */
export function optionListReducer(
  state: OptionListState,
  action: OptionListAction
): OptionListState {
  switch (action.type) {
    case "add":
      return {
        ...state,
        rows: [
          ...state.rows,
          { key: action.key, value: action.value, original: null },
        ],
        beforeSort: null,
      };
    case "remove":
      return {
        ...state,
        rows: state.rows.filter((row) => row.key !== action.key),
        beforeSort: null,
      };
    case "rename":
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.key === action.key ? { ...row, value: action.value } : row
        ),
        beforeSort: null,
      };
    case "reorder":
      return { ...state, rows: action.rows, beforeSort: null };
    case "sort":
      return {
        ...state,
        rows: sortOptionsAlphabetically(state.rows),
        beforeSort: state.rows,
      };
    case "undoSort":
      return state.beforeSort
        ? { ...state, rows: state.beforeSort, beforeSort: null }
        : state;
    case "mergeDuplicates": {
      const { rows, removed } = mergeDuplicates(state.rows);
      const intoKeyByRemovedKey = new Map(
        removed.map(({ row, intoKey }) => [row.key, intoKey])
      );
      return {
        rows,
        merged: [
          // A row removed now may itself hold earlier merges; they follow it.
          ...state.merged.map((entry) => ({
            ...entry,
            intoKey: intoKeyByRemovedKey.get(entry.intoKey) ?? entry.intoKey,
          })),
          ...removed.flatMap(({ row, intoKey }) =>
            row.original === null ? [] : [{ original: row.original, intoKey }]
          ),
        ],
        beforeSort: null,
      };
    }
  }
}
