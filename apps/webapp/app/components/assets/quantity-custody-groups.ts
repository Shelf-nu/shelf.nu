/**
 * Quantity Custody Groups
 *
 * Pure helpers behind the asset page's custody breakdown. The database keeps
 * one operator custody row per holder per source location, but the page shows
 * ONE line per person: their rows are grouped here, their units summed, and
 * for a pool with two or more sources the line says where the units came
 * from ("2 from Camera Room, 1 from Studio"). Kit-inherited rows stay their
 * own lines: they are released through the kit.
 *
 * @see {@link file://./quantity-custody-list.tsx}
 * @see {@link file://../../modules/asset/custody-source.ts}
 */

/** The fields of a custody record these helpers read. */
export type GroupableCustodyRecord = {
  id?: string;
  quantity?: number;
  kitCustodyId?: string | null;
  location?: { id: string; name: string } | null;
  custodian: { id: string };
};

/** One line of the custody breakdown. */
export type CustodyGroup<T extends GroupableCustodyRecord> =
  | {
      kind: "operator";
      /** React key, stable per person. */
      key: string;
      /** The person's first row: name, picture and ids come from it. */
      first: T;
      /** Every operator row the person holds on this asset. */
      rows: T[];
      /** Units summed over `rows`. */
      quantity: number;
    }
  | {
      kind: "kit";
      key: string;
      record: T;
    };

/**
 * Groups custody records into breakdown lines: one per person for operator
 * rows (in the order each person first appears), one per kit-inherited row.
 */
export function groupCustodyRecords<T extends GroupableCustodyRecord>(
  records: T[]
): CustodyGroup<T>[] {
  const groups: CustodyGroup<T>[] = [];
  const operatorIndex = new Map<string, number>();

  records.forEach((record, index) => {
    if (record.kitCustodyId) {
      groups.push({
        kind: "kit",
        key: `kit-${record.id ?? `${record.custodian.id}-${index}`}`,
        record,
      });
      return;
    }

    const existing = operatorIndex.get(record.custodian.id);
    if (existing !== undefined) {
      const group = groups[existing];
      if (group.kind === "operator") {
        group.rows.push(record);
        group.quantity += record.quantity ?? 1;
      }
      return;
    }

    operatorIndex.set(record.custodian.id, groups.length);
    groups.push({
      kind: "operator",
      key: `op-${record.custodian.id}`,
      first: record,
      rows: [record],
      quantity: record.quantity ?? 1,
    });
  });

  return groups;
}

/**
 * What a NULL source means on this pool: the unplaced units when the pool
 * has any, otherwise a source that was never recorded (custody older than
 * source tracking on a pool placed at several locations).
 */
export function nullSourceLabel(poolHasUnplaced: boolean): string {
  return poolHasUnplaced ? "unplaced" : "location not recorded";
}

/** One part of a person's source text. */
export type SourcePart = {
  /** Stable React key: the source's location id, or "none". */
  key: string;
  text: string;
  /** Rendered lighter: the source was never recorded. */
  muted: boolean;
};

/**
 * The source text after a person's quantity, for a pool with two or more
 * sources: "from Studio" for a single source, "2 from Camera Room, 1 from
 * Studio" for several, "unplaced" / "location not recorded" for NULL.
 *
 * @param rows - The person's operator rows
 * @param poolHasUnplaced - Whether the pool currently has unplaced units
 */
export function describeCustodySources(
  rows: GroupableCustodyRecord[],
  poolHasUnplaced: boolean
): SourcePart[] {
  const nullText = nullSourceLabel(poolHasUnplaced);

  if (rows.length === 1) {
    const [only] = rows;
    return only.location
      ? [
          {
            key: only.location.id,
            text: `from ${only.location.name}`,
            muted: false,
          },
        ]
      : [{ key: "none", text: nullText, muted: !poolHasUnplaced }];
  }

  return rows.map((row) => {
    const quantity = row.quantity ?? 1;
    return row.location
      ? {
          key: row.location.id,
          text: `${quantity} from ${row.location.name}`,
          muted: false,
        }
      : {
          key: "none",
          text: `${quantity} ${nullText}`,
          muted: !poolHasUnplaced,
        };
  });
}

/**
 * Where one line of a per-location release comes from: "From Camera Room",
 * "Unplaced" or "Location not recorded".
 */
export function releaseLineSource(
  row: GroupableCustodyRecord,
  poolHasUnplaced: boolean
): string {
  if (row.location) return `From ${row.location.name}`;
  return poolHasUnplaced ? "Unplaced" : "Location not recorded";
}

/**
 * The label of one source line in a per-location release:
 * "From Camera Room: max 2", "Unplaced: max 1" or
 * "Location not recorded: max 1".
 */
export function releaseLineLabel(
  row: GroupableCustodyRecord,
  poolHasUnplaced: boolean
): string {
  return `${releaseLineSource(row, poolHasUnplaced)}: max ${row.quantity ?? 1}`;
}
