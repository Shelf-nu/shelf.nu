import { data } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { z } from "zod";
import type { AuditPdfDbResult } from "~/modules/audit/pdf-helpers";
import { fetchAllAuditPdfRelatedData } from "~/modules/audit/pdf-helpers";
import { getDateTimeFormat } from "~/utils/client-hints";
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
 * Returns all necessary data for rendering an audit receipt PDF.
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

    // Format dates in user's local timezone for display in PDF
    const dateTimeFormat = getDateTimeFormat(request, {
      dateStyle: "short",
      timeStyle: "short",
    });

    const { createdAt, completedAt } = pdfMeta.session;

    // Format creation date if available
    if (createdAt) {
      pdfMeta.from = dateTimeFormat.format(new Date(createdAt));
    }

    // Format completion date if available
    if (completedAt) {
      pdfMeta.to = dateTimeFormat.format(new Date(completedAt));
    }

    // Sanitize activity note content to remove markdoc tags (server-side only)
    pdfMeta.activityNotes = pdfMeta.activityNotes.map((note) => ({
      ...note,
      content: sanitizeNoteContent(note.content || "", dateTimeFormat),
    }));

    return data(payload({ pdfMeta }));
  } catch (cause) {
    // Handle errors and return appropriate HTTP status
    const reason = makeShelfError(cause, { userId, auditId });
    throw data(error(reason), { status: reason.status });
  }
};
