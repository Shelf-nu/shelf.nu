/**
 * Mobile bulk-action id lists.
 *
 * The web list UI can send an `ALL_SELECTED_KEY` sentinel instead of ids,
 * meaning "everything matching the filters I am looking at". That contract only
 * works because the web client also submits `currentSearchParams`, so the
 * server can rebuild the same filtered set.
 *
 * The mobile client has no select-all control and sends no filters. If the
 * sentinel reaches a mobile bulk endpoint it therefore expands against an EMPTY
 * filter — every matching row in the organization — which is both unbounded and
 * invisible to the caller. On the custody endpoints that is reachable by
 * SELF_SERVICE, which holds `asset:custody` and `kit:custody`.
 *
 * So mobile rejects the sentinel outright rather than trying to support it. A
 * mobile client has no way to produce it legitimately; its presence means a
 * hand-crafted request.
 *
 * @see {@link file://./../../utils/list.ts} ALL_SELECTED_KEY
 */

import { z } from "zod";

import { ALL_SELECTED_KEY } from "~/utils/list";

/**
 * A non-empty list of explicit entity ids for a mobile bulk action.
 *
 * Rejects the select-all sentinel. Use this instead of a bare
 * `z.array(z.string())` on any mobile endpoint that forwards ids into a service
 * capable of expanding the sentinel.
 *
 * @param field - Field name used in the validation message (e.g. `assetIds`)
 * @returns A Zod schema for the id array
 */
export function mobileBulkIdsSchema(field: string) {
  return z
    .array(z.string().min(1))
    .min(1)
    .refine((ids) => !ids.includes(ALL_SELECTED_KEY), {
      message: `${field} must contain explicit ids. "Select all" is not supported on mobile.`,
    });
}
