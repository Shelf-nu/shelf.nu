/**
 * Writing and reading individual CSV cells.
 *
 * Every cell a Shelf export writes goes through {@link quoteCsvCell}, which is
 * what keeps a comma, a semicolon, a quote or a newline inside a value from
 * shifting the columns around it. On top of that, a few importer columns pack
 * several values into one cell — see {@link encodeCsvListCell}.
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
 * @see {@link file://./csv.server.ts} — writes the backup export
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
