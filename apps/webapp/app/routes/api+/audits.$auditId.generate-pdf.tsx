import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import { signAssetPhotosForPrint } from "~/modules/asset/print-images.server";
import type { AuditPdfDbResult } from "~/modules/audit/pdf-helpers";
import { fetchAllAuditPdfRelatedData } from "~/modules/audit/pdf-helpers";
import { getClientHint } from "~/utils/client-hints";
import { formatDate } from "~/utils/date-format";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import { sanitizeNoteContent } from "~/utils/note-sanitizer.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * API endpoint for generating audit receipt PDF data.
 * Returns all necessary data for rendering an audit receipt PDF, with lapsed
 * asset photos signed for print (read-only, no row cap) so every photo
 * prints. Sends one `pdf_preview_opened` event per preview.
 *
 * @see {@link file://./../../modules/asset/print-images.server.ts}
 *
 * @route GET /api/audits/:auditId/generate-pdf
 * @returns AuditPdfDbResult - Complete audit data with formatted dates
 * @throws 403 - If user lacks permission to view audit
 * @throws 404 - If audit not found
 */
export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const { userId } = context.getSession();

  // Parse and validate audit ID from URL params
  const { auditId } = getParams(
    params,
    z.object({
      auditId: z.string(),
    }),
    {
      additionalData: { userId },
    }
  );

  try {
    // Check if user has permission to read audits
    const { organizationId, role } = await requirePermission({
      userId: userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    // Fetch all PDF-related data (session, assets, images, notes, QR codes)
    const pdfMeta: AuditPdfDbResult = await fetchAllAuditPdfRelatedData(
      auditId,
      organizationId,
      userId,
      role,
      request
    );

    // Asset photos are signed URLs that stop loading once they lapse, and a
    // photo that does not load prints as the placeholder. The acting user's
    // format preferences (date order, time format, timezone) are resolved
    // alongside, so PDF dates render per their settings rather than the
    // request locale.
    const [signedAssets, prefs] = await Promise.all([
      signAssetPhotosForPrint(pdfMeta.assets, { organizationId }),
      resolveUserFormatPrefsById(userId, getClientHint(request)),
    ]);
    pdfMeta.assets = signedAssets;

    // Preserve the existing `.format(date)` call shape used below.
    const dateTimeFormat = {
      format: (date: Date) => formatDate(date, prefs, { includeTime: true }),
    };

    const { createdAt, completedAt } = pdfMeta.session;

    // Format creation date if available
    if (createdAt) {
      pdfMeta.from = dateTimeFormat.format(new Date(createdAt));
    }

    // Format completion date if available
    if (completedAt) {
      pdfMeta.to = dateTimeFormat.format(new Date(completedAt));
    }

    // Sanitize note content to remove markdoc tags (server-side only).
    //
    // why BOTH lists: a condition note written alongside photos carries an
    // embedded `{% audit_images ... /%}` tag (helpers.server.ts,
    // buildAuditImagesNoteContent). The PDF prints note content as plain text,
    // so an unsanitised one would put raw tag source in the receipt.
    pdfMeta.conditionNotes = pdfMeta.conditionNotes.map((note) => ({
      ...note,
      content: sanitizeNoteContent(note.content || "", prefs),
    }));
    pdfMeta.activityNotes = pdfMeta.activityNotes.map((note) => ({
      ...note,
      content: sanitizeNoteContent(note.content || "", prefs),
    }));

    captureServerEvent({
      distinctId: userId,
      event: "pdf_preview_opened",
      properties: {
        sheet: "audit_receipt",
        organizationId,
        rowCount: pdfMeta.assets.length,
        assetCount: new Set(pdfMeta.assets.map((asset) => asset.id)).size,
      },
    });

    return data(payload({ pdfMeta }));
  } catch (cause) {
    // Handle errors and return appropriate HTTP status
    const reason = makeShelfError(cause, { userId, auditId });
    throw data(error(reason), { status: reason.status });
  }
};
