import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * GET /api/mobile/kits?orgId=xxx&search=xxx&page=1&perPage=20&status=IN_CUSTODY
 *
 * Returns paginated kits for the given organization. Mirrors the mobile
 * assets list route so the companion app's Kits screen can reuse the same
 * list patterns (search, infinite scroll, status filter).
 *
 * @see {@link file://./assets.ts} the asset twin of this route
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);

    const rawSearch = url.searchParams.get("search") || "";
    const search = rawSearch.slice(0, 100);

    const rawPage = parseInt(url.searchParams.get("page") || "1", 10);
    const page = Number.isNaN(rawPage) ? 1 : Math.max(1, rawPage);

    const rawPerPage = parseInt(url.searchParams.get("perPage") || "20", 10);
    const perPage = Number.isNaN(rawPerPage)
      ? 20
      : Math.min(50, Math.max(1, rawPerPage));

    const skip = (page - 1) * perPage;

    const statusFilter = url.searchParams.get("status");

    const where: Record<string, unknown> = {
      organizationId,
      ...(search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    const [kits, totalCount] = await Promise.all([
      db.kit.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          image: true,
          imageExpiration: true,
          _count: { select: { assets: true } },
          custody: {
            select: {
              custodian: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: perPage,
      }),
      db.kit.count({ where }),
    ]);

    return data({
      kits,
      page,
      perPage,
      totalCount,
      totalPages: Math.ceil(totalCount / perPage),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
