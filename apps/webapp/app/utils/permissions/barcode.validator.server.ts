import type { Organization } from "@prisma/client";
import { ShelfError } from "../error";

/**
 * Server-side utility to check if barcodes are enabled for an organization
 */
export function organizationHasBarcodesEnabled(
  organization: Pick<Organization, "barcodesEnabled"> | undefined | null
): boolean {
  if (!organization) return false;
  return organization.barcodesEnabled;
}

/**
 * Server-side utility to validate that an organization has barcodes enabled
 * Throws ShelfError if not enabled
 */
export function validateBarcodeEnabled(
  organization: Pick<Organization, "barcodesEnabled"> | undefined | null,
  additionalData?: Record<string, any>
): void {
  if (!organizationHasBarcodesEnabled(organization)) {
    throw new ShelfError({
      cause: null,
      title: "Barcodes not enabled",
      message: "Barcode functionality is not enabled for this workspace",
      status: 403,
      additionalData,
      label: "Barcode",
      shouldBeCaptured: false,
    });
  }
}
