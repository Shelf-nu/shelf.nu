/**
 * Print Table
 *
 * The print layout every printed sheet's main table shares: the A4 page, the
 * wrapper reset that keeps Chrome printing at 100% scale, cell-drawn borders,
 * rows and row groups that never split across a page break, and a header that
 * repeats on every page. Plus the `<colgroup>` that fixes each column's share
 * of the table.
 *
 * A sheet renders {@link PrintTableStyles} once with its table's class name,
 * gives its wrapper the `pdf-wrapper` class, and lists its columns in
 * {@link PrintColGroup}.
 *
 * @see {@link file://./../booking/booking-overview-pdf.tsx}
 * @see {@link file://./../booking/booking-checkin-receipt-pdf.tsx}
 * @see {@link file://./../audit/audit-receipt-pdf.tsx}
 */

/** One column of a printed table and its share of the table's width. */
export type PrintTableColumn = { name: string; percent: number };

/**
 * Builds the print stylesheet for one sheet's table.
 *
 * @param tableClassName - The class on the sheet's `<table>`, without the dot
 * @returns The `@media print` CSS
 */
function buildPrintTableCss(tableClassName: string) {
  const table = `.${tableClassName}`;

  return `@media print {
  @page {
    margin: 10mm;
    size: A4;
  }
  /* The printable width IS the sheet: A4 minus the page margins. A
     fixed width wider than that makes Chrome shrink the whole page. */
  .pdf-wrapper {
    margin: 0 !important;
    padding: 0 !important;
    width: auto !important;
  }
  /* The cells draw every line. The table's own border would run
     down into the space a whole row leaves at the foot of a page. */
  ${table} {
    border: 0 !important;
    border-collapse: separate !important;
    border-spacing: 0 !important;
  }
  ${table} th,
  ${table} td {
    border-right: 1px solid #d1d5db !important;
    border-bottom: 1px solid #d1d5db !important;
  }
  ${table} thead th {
    border-top: 1px solid #d1d5db !important;
  }
  ${table} th:first-child,
  ${table} td:first-child {
    border-left: 1px solid #d1d5db !important;
  }
  /* A row never splits across a page break, and a row group (an asset's
     row plus the rows that belong to it) moves to the next page whole.
     The header repeats on every page. */
  ${table} tr,
  ${table} tbody {
    break-inside: avoid;
  }
  ${table} thead {
    display: table-header-group;
  }
}`;
}

/**
 * The print stylesheet for a sheet's table. Render it once per sheet.
 *
 * @param props.tableClassName - The class on the sheet's `<table>`, without
 *   the dot. It scopes the cell rules to that table, so other tables on the
 *   sheet keep their own borders.
 * @returns A `<style>` element
 */
export function PrintTableStyles({
  tableClassName,
}: {
  tableClassName: string;
}) {
  return <style>{buildPrintTableCss(tableClassName)}</style>;
}

/**
 * The `<colgroup>` of a printed table. The table is `table-fixed` and the
 * shares sum to 100, so the table is exactly the printable width and long text
 * wraps inside its column instead of pushing the table off the page.
 *
 * @param props.columns - The table's columns in order, each with its share of
 *   the width in percent
 * @returns A `<colgroup>` with one `<col>` per column
 */
export function PrintColGroup({
  columns,
}: {
  columns: readonly PrintTableColumn[];
}) {
  return (
    <colgroup>
      {columns.map((column) => (
        <col key={column.name} style={{ width: `${column.percent}%` }} />
      ))}
    </colgroup>
  );
}
