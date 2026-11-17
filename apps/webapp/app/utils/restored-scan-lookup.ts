/**
 * Marks a scanned-code lookup that no physical scan produced.
 *
 * A scan draft puts a parked list back as bare codes, and each row looks its
 * code up again to fetch the item. Those lookups go to the same endpoints a
 * fresh scan uses, and the endpoints record every lookup as a scan. A restored
 * row therefore sends this flag, and the endpoints skip the record: nobody
 * scanned the code just now, so scan history and "last scanned" must not say
 * they did. A fresh scan of the same code sends no flag and still records.
 *
 * Shared by the client that sets the flag and the endpoints that read it.
 *
 * @see {@link file://./scan-draft.ts} where restored entries come from
 * @see {@link file://./../components/scanner/drawer/generic-item-row.tsx}
 * @see {@link file://./../routes/api+/get-scanned-item.$qrId.ts}
 * @see {@link file://./../routes/api+/get-scanned-barcode.$value.ts}
 */

/** Search param a restored row adds to its lookup. */
export const RESTORED_LOOKUP_PARAM = "restored";

/** The value it carries. */
export const RESTORED_LOOKUP_VALUE = "1";

/**
 * Whether a lookup's `restored` search param marks it as a restored row's.
 *
 * Only the exact value counts, so a stray or mistyped param still records.
 *
 * @param value - The param's value, or `undefined` when absent
 * @returns `true` when the lookup must not be recorded as a scan
 */
export function isRestoredLookup(value: string | null | undefined): boolean {
  return value === RESTORED_LOOKUP_VALUE;
}
