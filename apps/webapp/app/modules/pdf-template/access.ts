/**
 * PDF Template Access
 *
 * Decides which workspaces have PDF templates: team workspaces only. The rule
 * reads the workspace type alone, never the premium features switch, so a
 * personal workspace has no templates on shelf.nu and on a self-hosted
 * install alike. It prints the built-in Checklist instead.
 *
 * Every server path that reads, seeds or writes templates gates on this:
 * the booking PDF route and the Settings > Bookings loader and action.
 *
 * @see {@link file://../../routes/_layout+/settings.bookings.tsx}
 * @see {@link file://../../routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */
import type { Organization } from "@prisma/client";
import { OrganizationType } from "@prisma/client";
import { ShelfError } from "~/utils/error";

/**
 * Whether a workspace has PDF templates.
 *
 * @param organization - The caller's current workspace
 * @returns `true` for a team workspace, `false` for any other type
 */
export function canUsePdfTemplates(organization: Pick<Organization, "type">) {
  return organization.type === OrganizationType.TEAM;
}

/**
 * Refuses a template read or write from a workspace that has no templates.
 *
 * @param organization - The caller's current workspace
 * @throws {ShelfError} 403 when the workspace is not a team workspace
 */
export function assertCanUsePdfTemplates(
  organization: Pick<Organization, "type">
) {
  if (!canUsePdfTemplates(organization)) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed",
      message: "PDF templates are available only in team workspaces.",
      status: 403,
      label: "PDF templates",
      shouldBeCaptured: false,
    });
  }
}
