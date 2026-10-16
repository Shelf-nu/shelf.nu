import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { LIST_ENTITIES } from "~/modules/list-navigation/list-context";
import { getListNeighbours } from "~/modules/list-navigation/neighbours.server";
import { LIST_NAVIGATION_REGISTRY } from "~/modules/list-navigation/registry.server";
import { makeShelfError } from "~/utils/error";
import {
  error,
  getCurrentSearchParams,
  parseData,
  payload,
} from "~/utils/http.server";
import { PermissionAction } from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const ListNeighboursQuerySchema = z.object({
  entity: z.enum(LIST_ENTITIES),
  id: z.string().min(1),
  /** The list's search string, without the leading `?`. */
  filters: z.string().default(""),
});

/**
 * The previous and next records around `id` in the list a detail page was
 * opened from, for the header's record arrows.
 *
 * Errors are RETURNED, not thrown: the arrows load this with a fetcher from
 * the detail routes, outside this route's tree, and a thrown response there
 * escalates to the outermost boundary and takes down the page.
 *
 * @returns `{ prev, next }`, each `{ id, page }` or `null`
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const { userId } = context.getSession();

  try {
    const { entity, id, filters } = parseData(
      getCurrentSearchParams(request),
      ListNeighboursQuerySchema,
      { shouldBeCaptured: false }
    );

    const caller = await requirePermission({
      userId,
      request,
      entity: LIST_NAVIGATION_REGISTRY[entity].permissionEntity,
      action: PermissionAction.read,
    });

    const neighbours = await getListNeighbours({
      entity,
      id,
      filters: filters.replace(/^\?/, ""),
      request,
      caller: { ...caller, userId },
    });

    return data(payload(neighbours));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    // No toast: the arrows already show the failure by staying disabled, and
    // a stale list context is ordinary, not an error the user must act on.
    return data(error(reason, false), { status: reason.status });
  }
}
