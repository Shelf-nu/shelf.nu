import { data, type LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
  getMobileUserContext,
} from "~/modules/api/mobile-auth.server";
import { requireAuditAssignee } from "~/modules/audit/service.server";
import { resolveMostPrivilegedRole } from "~/utils/booking-authorization.server";
import { makeShelfError } from "~/utils/error";
import { getParams } from "~/utils/http.server";
import { resolveUserDisplayName, type UserNameFields } from "~/utils/user";

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
/**
 * Upper bound on rows of each kind in one response.
 *
 * Matches the clamp every other mobile list route applies. An audit that
 * somehow holds more than this is past the point where a phone can usefully
 * render it, and the caller narrows with `auditAssetId` instead.
 */
const MAX_EVIDENCE_ROWS = 200;

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    const { roles, canUseAudits } = await getMobileUserContext(
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

    /**
     * Narrows the response to one audited asset.
     *
     * The client opens one row at a time, so this is the shape it actually
     * wants. Without it a single tap pulls every note and every photo of the
     * whole audit — on a large audit that is thousands of rows over cellular,
     * repeated on every open.
     */
    const url = new URL(request.url);
    const auditAssetId = url.searchParams.get("auditAssetId");

    // Gate the READ on assignment, exactly as the audit detail route does.
    // This route returns the notes and photos people recorded, which is the
    // same class of data that gate was added to protect: without it an
    // unassigned BASE or SELF_SERVICE user could read the evidence of any
    // audit in the workspace by id. The write halves (`audits.note`,
    // `audits.image`) already require it through
    // `requireAuditAssetInSession`; reading must not be the loose end.
    //
    // Resolved from ALL roles, never from `roles[0]`: `getMobileUserContext`
    // sets `role = roles[0]`, so a membership ordered [SELF_SERVICE, ADMIN]
    // would refuse a real admin who is not assigned.
    const effectiveRole = resolveMostPrivilegedRole(roles);
    const isSelfServiceOrBase =
      effectiveRole === "SELF_SERVICE" || effectiveRole === "BASE";

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

    await requireAuditAssignee({
      auditSessionId: auditId,
      organizationId,
      userId: user.id,
      isSelfServiceOrBase,
    });

    const [notes, images] = await Promise.all([
      db.auditNote.findMany({
        take: MAX_EVIDENCE_ROWS,
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
        where: {
          auditSessionId: auditId,
          type: "COMMENT",
          ...(auditAssetId ? { auditAssetId } : {}),
        },
        select: {
          id: true,
          content: true,
          createdAt: true,
          auditAssetId: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      db.auditImage.findMany({
        take: MAX_EVIDENCE_ROWS,
        where: {
          auditSessionId: auditId,
          organizationId,
          ...(auditAssetId ? { auditAssetId } : {}),
        },
        select: {
          id: true,
          imageUrl: true,
          thumbnailUrl: true,
          description: true,
          createdAt: true,
          auditAssetId: true,
          uploadedBy: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
              profilePicture: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    /** A person's display name, or null when the account is gone. */
    const actorName = (actor: UserNameFields | null) => {
      if (!actor) return null;
      const name = resolveUserDisplayName(actor);
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

    /**
     * Whether the clamp bit, so the client can say "showing the most recent
     * N" instead of presenting a short list as the whole truth.
     *
     * It matters most on the audit-wide call: `MAX_EVIDENCE_ROWS` applies
     * across the WHOLE audit, newest first, so once it bites the older
     * per-asset buckets come back short — or empty — while their count chips
     * still promise the real number. Without this flag "no photos" and
     * "photos we did not send" look identical. Narrow with `auditAssetId` to
     * get a bucket that cannot be clamped by unrelated rows.
     */
    const truncated =
      notes.length === MAX_EVIDENCE_ROWS || images.length === MAX_EVIDENCE_ROWS;

    return data({
      general: {
        notes: notes.filter((n) => !n.auditAssetId).map(serialiseNote),
        images: images.filter((i) => !i.auditAssetId).map(serialiseImage),
      },
      byAuditAsset,
      truncated,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
