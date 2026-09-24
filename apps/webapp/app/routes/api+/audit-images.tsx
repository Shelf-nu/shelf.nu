/**
 * Audit Images API
 *
 * Resolves `AuditImage` ids to renderable thumbnails for the `{% audit_images %}`
 * Markdoc tag used inside audit notes.
 *
 * @see {@link file://./../../components/markdown/audit-images-component.tsx}
 * @see {@link file://./../../modules/audit/note-content.server.ts}
 */

import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { makeShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Returns the images whose ids are listed in the `ids` query parameter.
 *
 * The ids arrive from note content, which is user-authored: a caller can ask
 * for any id at all. Access therefore has to be re-derived here rather than
 * inherited from whichever note did the asking — the same audit-scoped rule
 * the audit pages enforce. ADMIN/OWNER see every image in the workspace;
 * BASE and SELF_SERVICE see only images belonging to audits they are
 * assigned to.
 *
 * Ids the caller may not see are dropped from the result instead of failing
 * the request, so one unreachable image cannot blank out a note that also
 * embeds legitimate ones.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);
    const idsParam = url.searchParams.get("ids");

    if (!idsParam) {
      return data(payload({ images: [] }));
    }

    const imageIds = idsParam.split(",").filter(Boolean);

    if (imageIds.length === 0) {
      return data(payload({ images: [] }));
    }

    const images = await db.auditImage.findMany({
      where: {
        id: { in: imageIds },
        organizationId,
        ...(isSelfServiceOrBase
          ? {
              auditSession: { assignments: { some: { userId } } },
            }
          : {}),
      },
      select: {
        id: true,
        imageUrl: true,
        thumbnailUrl: true,
        description: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return data(payload({ images }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
