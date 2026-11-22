/**
 * Scan history API
 *
 * `GET /api/scans?assetId=<id>` or `?kitId=<id>`, with an optional `cursor`:
 * one page of the scan history sheet, newest first. Requires `scan:read`.
 * Exactly one of `assetId` and `kitId` is accepted; anything else is a 400.
 *
 * @see {@link file://./../../modules/scan/history.server.ts}
 * @see {@link file://./../../components/scan/scan-history-sheet.tsx}
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { getScanHistory } from "~/modules/scan/history.server";
import type { ScanTarget } from "~/modules/scan/target";
import { badRequest, makeShelfError } from "~/utils/error";
import {
  error,
  getCurrentSearchParams,
  parseData,
  payload,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * The refusal shown for any malformed scan history query. It covers a missing
 * or doubled target and an empty cursor alike, so it names the whole contract.
 */
const INVALID_QUERY_MESSAGE =
  "Invalid scan history query: ask for one asset or one kit.";

/**
 * Query for the scan history: exactly one of an asset or a kit, plus the
 * optional cursor (the id of the last scan already shown).
 */
const ScanHistoryQuerySchema = z
  .object({
    assetId: z.string().min(1).optional(),
    kitId: z.string().min(1).optional(),
    cursor: z.string().min(1).optional(),
  })
  .refine((query) => Boolean(query.assetId) !== Boolean(query.kitId), {
    message: INVALID_QUERY_MESSAGE,
  });

/**
 * Opt out of revalidation: the sheet loads on demand through a keyed fetcher,
 * and re-running its last URL after every unrelated action is wasted work.
 */
export function shouldRevalidate() {
  return false;
}

/**
 * Returns one page of scan history for an asset or kit in the caller's
 * active workspace.
 *
 * @param args - The loader arguments; `context` supplies the session user
 * @returns `{ error: null, scans, nextCursor }` on success, or
 *   `{ error }` with a 4xx/5xx status
 * @throws Never throws: every failure is returned as a JSON error response
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.scan,
      action: PermissionAction.read,
    });

    // A malformed query is a client error, not a fault: it is returned as a
    // 400 and kept out of Sentry (shouldBeCaptured: false).
    const { assetId, kitId, cursor } = parseData(
      getCurrentSearchParams(request),
      ScanHistoryQuerySchema,
      { message: INVALID_QUERY_MESSAGE, shouldBeCaptured: false }
    );

    // The schema has already refused a query with neither or both targets.
    // The guard keeps the branches exhaustive without a cast.
    let target: ScanTarget;
    if (assetId) {
      target = { assetId };
    } else if (kitId) {
      target = { kitId };
    } else {
      throw badRequest(INVALID_QUERY_MESSAGE, { shouldBeCaptured: false });
    }

    const page = await getScanHistory({ target, organizationId, cursor });

    return data(payload(page));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
