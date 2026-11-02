/**
 * Last Printed Document Cookie
 *
 * Remembers which document a person last printed a booking with, per workspace,
 * so the print dialog offers it first next time. One cookie per workspace;
 * its value names the user it belongs to, so a browser shared by two people
 * does not hand one person the other's pick.
 *
 * It is a preference, never a permission: the id it holds is checked against
 * the workspace's documents on every read (`resolvePdfDocumentForPrint`).
 *
 * @see {@link file://../../routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */
import { createCookie } from "react-router";
import { z } from "zod";

const lastDocumentSchema = z.object({
  userId: z.string(),
  documentId: z.string(),
});

function lastDocumentCookie(organizationId: string) {
  return createCookie(`${organizationId}_pdf_document`, {
    // Only the booking PDF route reads it, so no other request carries it.
    path: "/api/bookings",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * The document this user last printed with in this workspace.
 *
 * @returns The document id, or `null` when there is none or it is someone else's
 */
export async function readLastPdfDocumentId({
  request,
  organizationId,
  userId,
}: {
  request: Request;
  organizationId: string;
  userId: string;
}): Promise<string | null> {
  const value = await lastDocumentCookie(organizationId)
    .parse(request.headers.get("Cookie"))
    .catch(() => null);
  const parsed = lastDocumentSchema.safeParse(value);
  return parsed.success && parsed.data.userId === userId
    ? parsed.data.documentId
    : null;
}

/**
 * Remembers a document as this user's last pick in this workspace.
 *
 * @returns The `Set-Cookie` header value
 */
export function rememberPdfDocument({
  organizationId,
  userId,
  documentId,
}: {
  organizationId: string;
  userId: string;
  documentId: string;
}): Promise<string> {
  return lastDocumentCookie(organizationId).serialize({ userId, documentId });
}
