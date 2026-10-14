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
 * A `findMany` over `rows` that keeps them in array order, so a suite lists
 * rows oldest first to match the lookup's `createdAt` ordering.
 */
export function inMemoryBarcodeTable(rows: FakeBarcodeRow[]) {
  return {
    findMany: ({ where }: { where: Where }) =>
      Promise.resolve(rows.filter((row) => barcodeWhereMatches(row, where))),
  };
}
