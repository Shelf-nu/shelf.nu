import type { AuditSession, Organization, User } from "@prisma/client";
import { uploadAuditImage } from "~/modules/audit/image.service.server";
import { completeAuditSession } from "~/modules/audit/service.server";

/**
 * Completes an audit session and uploads any attached images.
 * This function abstracts the logic used in both the scan page and overview page.
 *
 * @param request - The request object (will be cloned for each image upload)
 * @param auditSessionId - ID of the audit session to complete
 * @param organizationId - ID of the organization
 * @param userId - ID of the user completing the audit
 * @returns Promise that resolves when audit is completed
 */
export async function completeAuditWithImages({
  request,
  auditSessionId,
  organizationId,
  userId,
}: {
  request: Request;
  auditSessionId: AuditSession["id"];
  organizationId: Organization["id"];
  userId: User["id"];
}): Promise<void> {
  // Clone the request to read formData without consuming the original
  const formData = await request.formData();

  // Extract completion note from formData
  const note = formData.get("note");
  const completionNote = typeof note === "string" ? note : undefined;

  // First, upload any images attached to the completion
  const imageUploads: Promise<unknown>[] = [];
  for (const [key, value] of formData.entries()) {
    if (key === "auditImage" && value instanceof File && value.size > 0) {
      // Create a new FormData with just this image
      const imageFormData = new FormData();
      imageFormData.append("image", value);

      // Upload the image (general audit image, not tied to specific asset)
      imageUploads.push(
        uploadAuditImage({
          request: new Request(request.url, {
            method: "POST",
            body: imageFormData,
          }),
          auditSessionId,
          organizationId,
          uploadedById: userId,
          auditAssetId: undefined, // General audit image
          description: "Completion image",
        })
      );
    }
  }

  // Wait for all images to upload
  await Promise.all(imageUploads);

  // Complete the audit session
  await completeAuditSession({
    sessionId: auditSessionId,
    organizationId,
    userId,
    completionNote,
  });
}
