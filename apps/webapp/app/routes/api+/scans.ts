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
import type { ScanTarget } from "~/modules/scan/service.server";
import { makeShelfError } from "~/utils/error";
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
    message: "Ask for the scans of one asset or one kit.",
  });

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

    const { assetId, kitId, cursor } = parseData(
      getCurrentSearchParams(request),
      ScanHistoryQuerySchema,
      { message: "Ask for the scans of one asset or one kit." }
    );

    // The schema guarantees exactly one of the two; the branch narrows the
    // type without an assertion.
    const target: ScanTarget = assetId
      ? { assetId }
      : { kitId: kitId as string };

    const page = await getScanHistory({ target, organizationId, cursor });

    return data(payload(page));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
