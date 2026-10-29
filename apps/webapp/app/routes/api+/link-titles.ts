/**
 * Name a link for the whole workspace.
 *
 * POST only, `asset: update` permission. The form carries `url` (the stored
 * custom field value) and `title` (blank clears the name, so chips fall back
 * to the page title). The name belongs to the workspace's link, not to one
 * asset field, so every asset showing the same link shows the new name, and
 * no note or activity event is written.
 *
 * @see {@link file://../../modules/link-preview/service.server.ts} `setLinkTitle`
 */

import { parseLink } from "@shelf/links";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { setLinkTitle } from "~/modules/link-preview/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const LinkTitleSchema = z.object({
  url: z.string(),
  title: z.string().optional().default(""),
});

/**
 * Sets or clears the workspace's name for a link.
 *
 * @returns `{ ok: true, linkTitle: { pageTitle, customTitle } }` with the
 *   link's titles after the change, or the standard error payload: 400 when
 *   `url` is not one web link, 403 without `asset: update`, 405 for a method
 *   other than POST.
 * @throws Never; every failure is returned as an error response.
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const { userId } = context.getSession();

  try {
    assertIsPost(request);

    // The workspace always comes from the session, never from the form.
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const { url, title } = parseData(await request.formData(), LinkTitleSchema);

    const link = parseLink(url);
    if (!link) {
      throw new ShelfError({
        cause: null,
        message: "Only a web link can be named.",
        label: "Link preview",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const linkTitle = await setLinkTitle({ organizationId, link, title });
    return payload({ ok: true, linkTitle });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
