import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createTag } from "~/modules/tag/service.server";
import { makeShelfError } from "~/utils/error";
import { getRandomColor } from "~/utils/get-random-color";
import { parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/tags/create
 *
 * Creates a new tag in the caller's organization so the mobile tag picker can
 * mint tags inline (admins/owners only — same `tag.create` permission the web
 * tag settings page enforces). The tag is created all-purpose (`useFor: []`,
 * usable on assets and bookings) with a server-picked color, mirroring the web
 * form's defaults.
 *
 * Body: `{ name: string }` — min 3 chars, same rule as the web
 * `NewTagFormSchema`. Duplicate names surface as a 400 via the tag service's
 * unique-constraint mapping.
 *
 * Query: ?orgId=...
 *
 * Response: `{ tag: { id, name } }` — the shape the picker consumes.
 *
 * @see {@link file://./tags.ts} the picker read (returns `canCreate` for UI gating).
 * @see {@link file://../../_layout+/tags.new.tsx} the web equivalent this mirrors.
 */

/** Mirrors the web `NewTagFormSchema.name` rule (min 3 chars). */
const CreateTagSchema = z.object({
  name: z.string().trim().min(3, "Name is required"),
});

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.tag,
      action: PermissionAction.create,
    });

    const body = await request.json();
    // parseData maps validation failures to a 400 ShelfError (a bare
    // schema.parse would throw ZodError -> generic 500 + Sentry capture).
    const { name } = parseData(body, CreateTagSchema, {
      // Expected user-input validation, not a server fault.
      shouldBeCaptured: false,
      additionalData: { userId: user.id, organizationId },
    });

    const tag = await createTag({
      name,
      description: null,
      // The mobile form has no color input; pick one server-side like the web
      // form's `colorFromServer` default.
      color: getRandomColor(),
      userId: user.id,
      organizationId,
      // All-purpose (assets AND bookings) — the web form's default when no
      // "use for" restriction is ticked.
      useFor: [],
    });

    return data({ tag: { id: tag.id, name: tag.name } });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
