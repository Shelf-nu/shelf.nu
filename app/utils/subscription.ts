import { OrganizationType, type Organization } from "@prisma/client";
import { ENABLE_PREMIUM_FEATURES } from "./env";

/** Utilities for checking weather the user can perform certain premium actions. */

export const canExportAssets = (
  tierLimit: { canExportAssets: boolean } | null | undefined
) => {
  /** If the premium features are not enabled, just return true */
  if (!premiumIsEnabled()) return true;
  if (tierLimit?.canExportAssets === null) return false;
  return tierLimit?.canExportAssets || false;
};

/** Important:
 * For this to work properly it needs to receive the tierLimit of the organization owner not the current user
 * This is because the owner is the one that has the premium package attached to their account
 */
export const canImportAssets = (
  tierLimit: { canImportAssets: boolean } | null | undefined
) => {
  /** If the premium features are not enabled, just return true */
  if (!premiumIsEnabled()) return true;
  if (!tierLimit?.canImportAssets) return false;
  return tierLimit?.canImportAssets;
};

export const canCreateMoreCustomFields = ({
  tierLimit,
  totalCustomFields,
}: {
  tierLimit: { maxCustomFields: number } | null | undefined;
  totalCustomFields: number;
}) => {
  if (!premiumIsEnabled()) return true;
  if (!tierLimit?.maxCustomFields) return false;

  return totalCustomFields < tierLimit?.maxCustomFields;
};

export const canCreateMoreOrganizations = ({
  tierLimit,
  totalOrganizations,
}: {
  tierLimit: { maxOrganizations: number } | null | undefined;
  totalOrganizations: number;
}) => {
  if (!premiumIsEnabled()) return true;
  if (!tierLimit?.maxOrganizations) return false;

  return totalOrganizations < tierLimit?.maxOrganizations;
};

export const canUseBookings = (
  currentOrganization: Pick<Organization, "type">
) => {
  if (!premiumIsEnabled()) return true;
  if (currentOrganization.type !== OrganizationType.TEAM) return false;

  return true;
};

export const premiumIsEnabled = () => ENABLE_PREMIUM_FEATURES;
