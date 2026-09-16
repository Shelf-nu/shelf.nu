/**
 * Column help content for the assets index.
 *
 * Structured data, not prose, so the renderer can SHOW the definition rather
 * than describe it: `Available` is best explained by its arithmetic, and
 * `Stock status` by the actual badges it emits. A paragraph explaining a
 * subtraction is worse than the subtraction.
 *
 * Deliberately JSX-free so this stays a plain module the renderer and tests can
 * both read. Rendering lives in `column-help-content.tsx`.
 *
 * Only columns that have genuinely confused someone, or that carry a definition
 * a reasonable person could get wrong, appear here. A header row full of info
 * icons trains people to ignore all of them — which is why this is down to
 * THREE. An earlier pass annotated six, including `Total quantity` and
 * `Available to book`, whose labels already say what they are. The three that
 * remain are the ones whose value depends on the asset's tracking method, so the
 * same header renders a number on one row and an em dash on the next.
 *
 * @see {@link file://../../components/assets/assets-index/column-help-content.tsx} - renders this.
 * @see {@link file://./helpers.ts} - the column vocabulary these annotate.
 */

import type { StockStatus } from "@shelf/quantity-control";

import type { ColumnLabelKey } from "./helpers";

/** One line of a subtraction shown as a stacked sum. */
export type HelpFormulaRow = {
  /** Operator shown in its own gutter. Omit on the first row. */
  op?: "−" | "=";
  /** What is being added or taken away. */
  label: string;
  /** Renders as the result: emphasised, above a rule. */
  isResult?: boolean;
};

/** One row of a badge legend, showing the real badge beside its rule. */
export type HelpLegendRow = {
  /** The verdict to render. `null` renders the em-dash "no opinion" cell. */
  status: StockStatus | null;
  /** The rule, in the fewest words that are still true. */
  text: string;
};

/** Structured help for one column. Every field beyond `summary` is optional. */
export type ColumnHelp = {
  /** One short line. Always shown, always first. */
  summary: string;
  /** Renders as a stacked subtraction. Mutually exclusive with `legend`. */
  formula?: readonly HelpFormulaRow[];
  /** Renders as a badge legend. Mutually exclusive with `formula`. */
  legend?: readonly HelpLegendRow[];
  /** The caveat that trips people up. Shown in a muted callout. */
  note?: string;
  /** When the cell is empty. The single most common question about these columns. */
  blankWhen?: string;
};

/**
 * Help per column. A `Partial` on purpose — adding an entry should be a
 * decision, not a default.
 */
export const COLUMN_HELP: Partial<Record<ColumnLabelKey, ColumnHelp>> = {
  available: {
    summary: "Units you could hand over right now, today.",
    formula: [
      { label: "Total quantity" },
      { op: "−", label: "In custody" },
      { op: "−", label: "In kits" },
      { op: "−", label: "Checked out" },
      { op: "=", label: "Free now", isResult: true },
    ],
    note: "Units promised to a future booking are still on the shelf, so they are NOT subtracted here \u2014 that is why a row can read 10 free now and still be Short. Units inside a kit count under In kits, even while the kit is in custody or out on a booking.",
    blankWhen: "Tracked individually — the Status column answers this instead.",
  },

  reserved: {
    summary: "Units promised to bookings that have not started yet.",
    note: "For a quantity pool this counts across every upcoming booking, so it can be higher than you need on any one day. An individually-tracked asset shows how many upcoming bookings claim it.",
    blankWhen: "Never — this column applies to every asset.",
  },

  stockStatus: {
    summary: "Whether this pool needs attention right now.",
    legend: [
      {
        status: "SHORT",
        text: "At some point ahead, custody, kits and overlapping bookings need more than you own",
      },
      { status: "NONE_FREE", text: "Nothing available to hand over" },
      { status: "LOW", text: "At or below your reorder point" },
      { status: "ENOUGH", text: "Above your reorder point" },
      { status: null, text: "No reorder point set, so we make no judgement" },
    ],
    blankWhen: "Tracked individually — there is no pool to judge.",
  },
};

/**
 * Returns the help for a column, if it has any.
 *
 * @param name - The column key, including `cf_`-prefixed custom fields.
 * @returns The structured help, or `undefined` when the column's label speaks
 *   for itself (which is most of them).
 */
export function getColumnHelp(name: ColumnLabelKey): ColumnHelp | undefined {
  return COLUMN_HELP[name];
}
