/**
 * Asset import preview rows endpoint.
 *
 * `GET /api/asset-imports/:importId/preview-rows?offset=N` returns the next
 * page of preview grid rows of the viewer's DRAFT import, for the preview
 * stage's "Load more" button. The upload response carries the first page.
 *
 * @see {@link file://./../../modules/asset-import/preview.server.ts}
 * @see {@link file://./../../components/assets/import-content/preview-stage.tsx}
 */
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { getContentImportPreviewRows } from "~/modules/asset-import/preview.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { requiredNumberFromString } from "~/utils/zod-numeric";

/**
 * Returns one page of preview rows of a draft import in the active workspace.
 *
 * @returns `{ rows, nextOffset }`
 * @throws 400 on a missing or invalid offset, 404 when the draft is not the
 * viewer's or is no longer a draft, 403 without `asset: import`
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    });

    const { importId } = getParams(
      params,
      z.object({ importId: z.string().min(1) })
    );

    // A blank offset is refused rather than read as 0, so a client that lost
    // its offset never silently reloads the first page.
    const { offset } = parseData(
      new URL(request.url).searchParams,
      z.object({
        offset: requiredNumberFromString({ fieldName: "Offset" }).pipe(
          z.number().int().min(0)
        ),
      }),
      { shouldBeCaptured: false }
    );

    const page = await getContentImportPreviewRows({
      importId,
      organizationId,
      userId,
      offset,
    });

    return data(payload(page));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
