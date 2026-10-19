/**
 * Writing and reading individual CSV cells.
 *
 * Every cell a Shelf export writes goes through {@link quoteCsvCell}, which is
 * what keeps a comma, a semicolon, a quote or a newline inside a value from
 * shifting the columns around it. On top of that, a few importer columns pack
 * several values into one cell (see {@link encodeCsvListCell}), and exports a
 * spreadsheet opens guard formula-leading text with
 * {@link neutralizeCsvFormula}, which the import parser reverses.
 *
 * Those columns are `tags` and each `barcode_<Type>`. The values themselves may
 * legally contain a comma — a tag named `Berlin, DE`, a Code128 value
 * `SN-2024,001`, an ExternalQR holding a URL with a coordinate pair — so the
 * list needs the same quoting CSV already uses for the cell around it: an item
 * carrying a comma, a quote or edge whitespace is wrapped in double quotes,
 * and its own quotes are doubled.
 *
 * A list with nothing to escape is left exactly as written, so `a,b,c` means
 * three items whether a person typed it or the exporter produced it.
 *
 * Items come back trimmed, quoted or not: every consumer stores trimmed names,
 * so edge whitespace has nowhere to go and keeping it only produces lookups
 * that match nothing.
 *
 * A leading `"` always opens a quoted item. That makes quoting the only way to
 * express a value that itself begins with a quote — `"""ABCD"""` as cell
 * content, which is what the exporter emits — and it makes a bare `"ABCD"` read
 * as `ABCD`, the quotes taken as syntax. Values beginning with a quote are
 * legal in Code128, DataMatrix and ExternalQR, so that reading is a real
 * choice, not an oversight: one cell shape has to win, and an unescaped
 * `"ABCD"` is far more likely to be a quoted `ABCD` than a value whose first
 * character is a quote.
 *
 * @see {@link file://./import-ready-export.server.ts} — writes the import-ready export
 * @see {@link file://./import.server.ts} — reads the `tags` cell
 * @see {@link file://./../modules/barcode/service.server.ts} — reads the barcode cells
 */

/**
 * Wraps a value as one CSV cell, per RFC 4180: always quoted, with embedded
 * quotes doubled.
 *
 * Quoting unconditionally rather than only when a delimiter is present keeps
 * the writer independent of which delimiter the file uses, and keeps a cell
 * that merely looks numeric from being reformatted by a spreadsheet.
 *
 * @param value - The raw cell value.
 * @returns The quoted cell, ready to join with a delimiter.
 */
export function quoteCsvCell(value: string): string {
  return `"${(value ?? "").replace(/"/g, '""')}"`;
}

/** An item needs quoting when a bare split would not give it back unchanged. */
const NEEDS_QUOTING = /[",]/;

/**
 * Packs several values into one CSV cell.
 *
 * @param values - The values, in the order they should appear.
 * @returns The cell content (still unquoted as a CSV cell — the caller's CSV
 * writer quotes the cell itself).
 */
export function encodeCsvListCell(values: string[]): string {
  return values
    .map((value) =>
      NEEDS_QUOTING.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    )
    .join(",");
}

/**
 * Reads a multi-value cell back into its items.
 *
 * Every item comes back trimmed, quoted or not, so ` a , b ` and `" a "` yield
 * `a` and `b`. That is a contract callers rely on: tag names are stored
 * trimmed, so a name resolved under an untrimmed key matches nothing and the
 * write that follows sees an empty list. Empty items are dropped.
 *
 * @param cell - The cell content, after the CSV parser has unquoted the cell.
 * @returns The items it holds, each trimmed.
 */
export function decodeCsvListCell(cell: string): string[] {
  const items: string[] = [];

  let current = "";
  let inQuotes = false;

  const pushCurrent = () => {
    const item = current.trim();
    if (item) items.push(item);
    current = "";
  };

  for (let index = 0; index < cell.length; index++) {
    const char = cell[index];

    if (inQuotes) {
      // A doubled quote inside a quoted item is one literal quote.
      if (char === '"' && cell[index + 1] === '"') {
        current += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
      continue;
    }

    // A quote only opens an item when nothing but whitespace precedes it;
    // anywhere else it is part of the value, as it is in CSV itself.
    if (char === '"' && current.trim() === "") {
      inQuotes = true;
      current = "";
      continue;
    }

    if (char === ",") {
      pushCurrent();
      continue;
    }

    current += char;
  }

  pushCurrent();

  return items;
}

/**
 * A cell a spreadsheet would run as a formula: one starting with `=`, `+`, `-`
 * or `@` (CWE-1236). Leading apostrophes are part of the match so that a value
 * which already starts with `'` before one of those characters gains one more
 * on export and loses exactly one on import, which keeps the pair lossless.
 */
const FORMULA_LEADING = /^'*[=+\-@]/;

/**
 * A negative number as the exports write it: `-5`, `-1,234.50`, `-$5.00`.
 * Digits, separators and at most one symbol cannot form a formula, and leaving
 * them alone keeps valuations and amounts summable in a spreadsheet.
 */
const NEGATIVE_NUMBER = /^-[$€£¥₹₽₩₪₫฿₴₦₲₵₡₺₨]?\d[\d,]*(\.\d+)?$/;

/**
 * Neutralises spreadsheet formula injection in one cell value by prefixing it
 * with a single quote, which Excel and Google Sheets show as literal text.
 *
 * Apply it to the raw value, before quoting. Every importer reads the cell back
 * through {@link restoreCsvFormulaCell}, so a guarded file re-imports unchanged.
 *
 * @param value - The raw cell value.
 * @returns The value, prefixed with `'` when a spreadsheet would evaluate it.
 */
export function neutralizeCsvFormula(value: string): string {
  if (!FORMULA_LEADING.test(value) || NEGATIVE_NUMBER.test(value)) {
    return value;
  }
  return `'${value}`;
}

/**
 * Reverses {@link neutralizeCsvFormula} for one parsed cell: drops the single
 * quote it added, and leaves every other value as it is.
 *
 * @param cell - The cell content, after the CSV parser has unquoted the cell.
 * @returns The value as it was before export.
 */
export function restoreCsvFormulaCell(cell: string): string {
  return cell.startsWith("'") && FORMULA_LEADING.test(cell)
    ? cell.slice(1)
    : cell;
}
