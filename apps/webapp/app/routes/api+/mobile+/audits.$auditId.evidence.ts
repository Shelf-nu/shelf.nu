import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";

/**
 * GET /api/mobile/audits/:auditId/evidence
 *
 * Everything a person recorded ON an audit, so the phone can READ it back.
 *
 * why this route exists: the companion could already WRITE evidence
 * (`audits.note`, `audits.image`) and its detail payload carries per-asset
 * COUNTS, but nothing served the content. So a field worker photographed a
 * scratched lens, completed the audit, and then had no way to see any of it
 * again — every note and photo they had just taken was visible only on the
 * web app. Counts without content is the worst of both: the app knows the
 * evidence exists and still cannot show it.
 *
 * Two buckets, because the schema has two:
 *   - `general` — rows with `auditAssetId: null`. The completion note and the
 *     photos attached when the audit was closed. About the audit as a whole.
 *   - `byAuditAsset` — keyed by `auditAsset.id`, matching the `auditAssetId`
 *     the detail payload already hands the client, so the app can look up a
 *     row without a second round trip or any id juggling.
 *
 * Read-only by design. Editing and deleting evidence stays on the web, where
 * the confirm affordances live; this is for reviewing in the field.
 *
 * Query params:
 *   - orgId (required): organization ID
 *
 * @see {@link file://./audits.$auditId.ts} the detail payload whose
 *   `auditAssetId` values key `byAuditAsset`
 * @see {@link file://./audits.note.ts} and {@link file://./audits.image.ts}
 *   the write halves this completes
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
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

    const { auditId } = getParams(
      params,
      z.object({ auditId: z.string().min(1) })
    );

    // Prove the audit is in this workspace before reporting anything about
    // it, so a guessed id from another org cannot be probed through this
    // route. Mirrors the guard on the asset-bookings route.
    const audit = await db.auditSession.findFirst({
      where: { id: auditId, organizationId },
      select: { id: true },
    });

    if (!audit) {
      return data(
        { error: { message: "Audit not found in this workspace." } },
        { status: 404 }
      );
    }

    const [notes, images] = await Promise.all([
      db.auditNote.findMany({
        // why COMMENT only: `AuditNote` holds two unrelated things. `UPDATE`
        // rows are the system activity trail ("X started this audit") and are
        // written as MARKDOC SOURCE — `{% link to="/settings/team/users/..." /%}`.
        // The web feed renders that through `MarkdownViewer`; the phone has no
        // Markdoc renderer, so an unfiltered query puts raw tag source on
        // screen. `COMMENT` rows are what a person actually typed, which is
        // the only thing this route means by evidence. Verified against a real
        // workspace: 9 UPDATE rows carrying tag source, 1 COMMENT.
        //
        // It also keeps this route agreeing with the COUNTS the client already
        // has — `getAssetsForAuditSession` filters its `_count` the same way,
        // so a row promising 1 attachment opens a sheet holding exactly 1.
        where: { auditSessionId: auditId, type: "COMMENT" },
        select: {
          id: true,
          content: true,
          createdAt: true,
          auditAssetId: true,
          user: {
            select: { firstName: true, lastName: true, profilePicture: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.auditImage.findMany({
        where: { auditSessionId: auditId, organizationId },
        select: {
          id: true,
          imageUrl: true,
          thumbnailUrl: true,
          description: true,
          createdAt: true,
          auditAssetId: true,
          uploadedBy: {
            select: { firstName: true, lastName: true, profilePicture: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    /** A person's display name, or null when the account is gone. */
    const actorName = (
      actor: { firstName: string | null; lastName: string | null } | null
    ) => {
      if (!actor) return null;
      const name = [actor.firstName, actor.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      return name.length > 0 ? name : null;
    };

    const serialiseNote = (n: (typeof notes)[number]) => ({
      id: n.id,
      content: n.content,
      createdAt: n.createdAt.toISOString(),
      authorName: actorName(n.user),
      authorImage: n.user?.profilePicture ?? null,
    });

    const serialiseImage = (i: (typeof images)[number]) => ({
      id: i.id,
      imageUrl: i.imageUrl,
      // why: fall back to the full image rather than sending null. The app
      // renders a thumbnail grid, and a missing thumbnail there would show a
      // gap where a photo plainly exists.
      thumbnailUrl: i.thumbnailUrl ?? i.imageUrl,
      description: i.description,
      createdAt: i.createdAt.toISOString(),
      authorName: actorName(i.uploadedBy),
      authorImage: i.uploadedBy?.profilePicture ?? null,
    });

    /** Per-asset buckets, keyed by the `auditAssetId` the client already has. */
    const byAuditAsset: Record<
      string,
      {
        notes: ReturnType<typeof serialiseNote>[];
        images: ReturnType<typeof serialiseImage>[];
      }
    > = {};

    const bucket = (auditAssetId: string) => {
      if (!byAuditAsset[auditAssetId]) {
        byAuditAsset[auditAssetId] = { notes: [], images: [] };
      }
      return byAuditAsset[auditAssetId];
    };

    for (const n of notes) {
      if (n.auditAssetId) bucket(n.auditAssetId).notes.push(serialiseNote(n));
    }
    for (const i of images) {
      if (i.auditAssetId) bucket(i.auditAssetId).images.push(serialiseImage(i));
    }

    return data({
      general: {
        notes: notes.filter((n) => !n.auditAssetId).map(serialiseNote),
        images: images.filter((i) => !i.auditAssetId).map(serialiseImage),
      },
      byAuditAsset,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
