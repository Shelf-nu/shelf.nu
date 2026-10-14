/**
 * An in-memory stand-in for the `Barcode` table, so scan-lookup tests replay
 * what Postgres would return for a handful of rows instead of pinning the
 * query shape.
 *
 * @see {@link file://../../app/modules/barcode/service.server.ts} getBarcodeByValue
 */

export interface FakeBarcodeRow {
  id: string;
  value: string;
  type: "Code128" | "Code39" | "DataMatrix" | "ExternalQR" | "EAN13";
  organizationId: string;
  assetId: string | null;
  kitId: string | null;
}

type Where = Record<string, unknown>;

/**
 * Evaluates a barcode `where` against one row. Models the operators the
 * barcode lookups emit: scalar equality, `{ in: [...] }`, and `OR` / `AND`
 * arrays of sub-clauses. Any other operator throws, so a query this fake does
 * not understand fails loudly instead of matching by accident.
 */
export function barcodeWhereMatches(
  row: FakeBarcodeRow,
  where: Where
): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") {
      return (condition as Where[]).some((sub) =>
        barcodeWhereMatches(row, sub)
      );
    }
    if (key === "AND") {
      return (condition as Where[]).every((sub) =>
        barcodeWhereMatches(row, sub)
      );
    }
    const actual = row[key as keyof FakeBarcodeRow];
    if (condition !== null && typeof condition === "object") {
      const ops = Object.keys(condition);
      if (ops.length === 1 && ops[0] === "in") {
        return (condition as { in: unknown[] }).in.includes(actual);
      }
      throw new Error(`Unsupported barcode where operator: ${ops.join(",")}`);
    }
    return actual === condition;
  });
}

/**
 * `findFirst` / `findMany` implementations over `rows`, in insertion order, the
 * way Postgres returns an unordered scan of a small table.
 */
export function inMemoryBarcodeTable(rows: FakeBarcodeRow[]) {
  const matching = ({ where }: { where: Where }) =>
    rows.filter((row) => barcodeWhereMatches(row, where));
  return {
    findFirst: (args: { where: Where }) =>
      Promise.resolve(matching(args)[0] ?? null),
    findMany: (args: { where: Where }) => Promise.resolve(matching(args)),
  };
}
