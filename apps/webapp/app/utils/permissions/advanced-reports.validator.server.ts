/**
 * Advanced Reports add-on gate.
 *
 * The report builder (`/reports/builder`) is a per-workspace add-on switched
 * by `Organization.advancedReportsEnabled`. Loaders and actions behind it call
 * {@link validateAdvancedReportsEnabled} after the permission check, so a
 * workspace without the add-on gets a 403 rather than data.
 *
 * Mirrors `audit.validator.server.ts`; the premium-flag shortcut for
 * self-hosted instances lives in `canUseAdvancedReports`
 * (`~/utils/subscription.server`), which callers use to decide what to
 * render, while this validator decides what to serve.
 *
 * @see {@link file://./audit.validator.server.ts}
 * @see {@link file://../subscription.server.ts}
 */

import type { Organization } from "@prisma/client";
import { ShelfError, type AdditionalData } from "../error";
import { canUseAdvancedReports } from "../subscription.server";

/**
 * Whether the workspace may use the report builder.
 *
 * @param organization - The current workspace, or nothing
 * @returns `false` for a missing workspace; otherwise the gate's answer
 */
export function organizationHasAdvancedReportsEnabled(
  organization: Pick<Organization, "advancedReportsEnabled"> | undefined | null
): boolean {
  if (!organization) return false;
  return canUseAdvancedReports(organization);
}

/**
 * Throws when the workspace may not use the report builder.
 *
 * @param organization - The current workspace, or nothing
 * @param additionalData - Context attached to the error for debugging
 * @throws {ShelfError} 403 "Advanced Reports not enabled"
 */
export function validateAdvancedReportsEnabled(
  organization: Pick<Organization, "advancedReportsEnabled"> | undefined | null,
  additionalData?: AdditionalData
): void {
  if (!organizationHasAdvancedReportsEnabled(organization)) {
    throw new ShelfError({
      cause: null,
      title: "Advanced Reports not enabled",
      message: "The report builder is not enabled for this workspace",
      status: 403,
      additionalData,
      label: "Report",
      shouldBeCaptured: false,
    });
  }
}
