/**
 * Quantity Custody Groups
 *
 * Pure helpers behind the asset page's custody breakdown. The database keeps
 * one operator custody row per holder per source location, but the page shows
 * ONE line per person: their rows are grouped here, their units summed, and
 * for a pool placed at two or more locations the line says where the units came
 * from ("2 from Camera Room, 1 from Studio"). Kit-inherited rows stay their
 * own lines: they are released through the kit.
 *
 * @see {@link file://./quantity-custody-list.tsx}
 * @see {@link file://../../modules/asset/custody-source.ts}
 */

import { custodySourceKey } from "~/modules/asset/custody-source";

/** The fields of a custody record these helpers read. */
export type GroupableCustodyRecord = {
  id?: string;
  quantity?: number;
  kitCustodyId?: string | null;
  location?: { id: string; name: string } | null;
  /** `Custody.sourceUnknown`: with no location, the source was never recorded. */
  sourceUnknown?: boolean;
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
 * What a row without a location means: the unplaced units, or, when
 * `sourceUnknown` is set, a source that was never recorded.
 */
export function nullSourceLabel(sourceUnknown: boolean): string {
  return sourceUnknown ? "location not recorded" : "unplaced";
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
 * Studio" for several, "unplaced" / "location not recorded" without a
 * location.
 *
 * @param rows - The person's operator rows
 */
export function describeCustodySources(
  rows: GroupableCustodyRecord[]
): SourcePart[] {
  if (rows.length === 1) {
    const [only] = rows;
    const unknown = Boolean(only.sourceUnknown);
    return only.location
      ? [
          {
            key: only.location.id,
            text: `from ${only.location.name}`,
            muted: false,
          },
        ]
      : [
          {
            key: unknown ? "unrecorded" : "unplaced",
            text: nullSourceLabel(unknown),
            muted: unknown,
          },
        ];
  }

  return rows.map((row) => {
    const quantity = row.quantity ?? 1;
    const unknown = Boolean(row.sourceUnknown);
    return row.location
      ? {
          key: row.location.id,
          text: `${quantity} from ${row.location.name}`,
          muted: false,
        }
      : {
          key: unknown ? "unrecorded" : "unplaced",
          text: `${quantity} ${nullSourceLabel(unknown)}`,
          muted: unknown,
        };
  });
}

/**
 * Where one line of a per-location release comes from: "From Camera Room",
 * "Unplaced" or "Location not recorded".
 */
export function releaseLineSource(row: GroupableCustodyRecord): string {
  if (row.location) return `From ${row.location.name}`;
  return row.sourceUnknown ? "Location not recorded" : "Unplaced";
}

/**
 * The value a release posts to name a row's source: its location id,
 * `"unplaced"`, or `"unrecorded"`. Same as `custodySourceKey` on the server.
 */
export function releaseSourceValue(row: GroupableCustodyRecord): string {
  return custodySourceKey({
    locationId: row.location?.id ?? null,
    sourceUnknown: Boolean(row.sourceUnknown),
  });
}
