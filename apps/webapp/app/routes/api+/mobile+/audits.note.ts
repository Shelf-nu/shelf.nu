import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { requireAuditAssetInSession } from "~/modules/audit/mobile-evidence.server";
import { stripMarkdocDelimiters } from "~/modules/audit/note-content.server";
import { NOTE_MAX_CONTENT_LENGTH } from "~/utils/constants";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/audits/note
 *
 * Creates a condition note tied to a scanned asset within an audit — the
 * per-asset evidence the audit PDF report renders. Mirrors the webapp
 * `create-note` intent in
 * `routes/_layout+/audits.$auditId.scan.$auditAssetId.details.tsx`.
 *
 * Query params:
 *   - orgId (required): organization ID
 *
 * Body (JSON): `{ auditSessionId, auditAssetId, content }`
 *
 * @param args - Remix action args; `request` carries the bearer auth
 *   header, the `orgId` query param, and the JSON body
 * @returns JSON `{ note }` on success, else `{ error: { message } }` 4xx
 * @throws Never — failures are caught and returned via `makeShelfError`
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    // Paid Audits add-on gate. #2551 replaced the standalone
    // `requireMobileAuditsEnabled` helper with the `canUseAudits` flag on
    // `getMobileUserContext` — mirror `audits.complete.ts` so the revenue
    // gate stays consistent across every mobile audit route.
    const { canUseAudits } = await getMobileUserContext(
      user.id,
      organizationId
    );
    if (!canUseAudits) {
      return data(
        {
          error: {
            message:
              "Audits are not enabled for this workspace. Contact your admin to enable this feature.",
          },
        },
        { status: 403 }
      );
    }

    const parsed = z
      .object({
        auditSessionId: z.string().min(1),
        auditAssetId: z.string().min(1),
        content: z
          .string()
          .trim()
          .min(1, "Note content is required")
          .max(NOTE_MAX_CONTENT_LENGTH),
      })
      .safeParse(await request.json());

    if (!parsed.success) {
      return data(
        {
          error: {
            message: parsed.error.issues[0]?.message ?? "Invalid request body",
          },
        },
        { status: 400 }
      );
    }

    const { auditSessionId, auditAssetId, content: rawContent } = parsed.data;

    // Audit note content is rendered through Markdoc in the audit feed
    // (`audit-asset-note-item.tsx` → MarkdownViewer) and the PDF path
    // assumes notes are sanitized server-side. Strip `{%`/`%}` from this
    // user-authored note so a client cannot persist a Markdoc tag (e.g.
    // `{% audit_images ids="..." /%}`) that surfaces another asset's
    // evidence — the same neutralization the image-evidence path applies.
    const content = stripMarkdocDelimiters(rawContent);
    if (!content) {
      return data(
        { error: { message: "Note content is required" } },
        { status: 400 }
      );
    }

    // Org-scoped session + asset-in-session + assignee scoping (shared with
    // the image route; unit-tested in mobile-evidence.server.test.ts).
    await requireAuditAssetInSession({
      auditSessionId,
      auditAssetId,
      organizationId,
      userId: user.id,
    });

    const note = await db.auditNote.create({
      data: {
        content,
        auditSessionId,
        auditAssetId,
        userId: user.id,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
            profilePicture: true,
          },
        },
      },
    });

    return data({ note });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
