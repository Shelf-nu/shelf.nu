/**
 * Last Printed Template Cookie
 *
 * Remembers which template a person last printed a booking with, per workspace,
 * so the print dialog offers it first next time. One cookie per workspace;
 * its value names the user it belongs to, so a browser shared by two people
 * does not hand one person the other's pick.
 *
 * It is a preference, never a permission: the id it holds is checked against
 * the workspace's templates on every read (`resolvePdfTemplateForPrint`).
 *
 * @see {@link file://../../routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */
import { createCookie } from "react-router";
import { z } from "zod";

const lastTemplateSchema = z.object({
  userId: z.string(),
  templateId: z.string(),
});

function lastTemplateCookie(organizationId: string) {
  return createCookie(`${organizationId}_pdf_template`, {
    // Only the booking PDF route reads it, so no other request carries it.
    path: "/api/bookings",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/**
 * The template this user last printed with in this workspace.
 *
 * @returns The template id, or `null` when there is none or it is someone else's
 */
export async function readLastPdfTemplateId({
  request,
  organizationId,
  userId,
}: {
  request: Request;
  organizationId: string;
  userId: string;
}): Promise<string | null> {
  const value = await lastTemplateCookie(organizationId)
    .parse(request.headers.get("Cookie"))
    .catch(() => null);
  const parsed = lastTemplateSchema.safeParse(value);
  return parsed.success && parsed.data.userId === userId
    ? parsed.data.templateId
    : null;
}

/**
 * Remembers a template as this user's last pick in this workspace.
 *
 * @returns The `Set-Cookie` header value
 */
export function rememberPdfTemplate({
  organizationId,
  userId,
  templateId,
}: {
  organizationId: string;
  userId: string;
  templateId: string;
}): Promise<string> {
  return lastTemplateCookie(organizationId).serialize({ userId, templateId });
}
