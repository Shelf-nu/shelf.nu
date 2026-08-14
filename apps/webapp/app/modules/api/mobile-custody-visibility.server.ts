/**
 * Mobile Custody Visibility (server)
 *
 * Server-side twin of the web's custody-visibility rules so the mobile API
 * never ships other holders' custody data to viewers who may not see it.
 * The web enforces this CLIENT-side (the loader ships everything and the
 * components filter); mobile clients are untrusted, so the same rules must
 * run on the server before the payload leaves the API.
 *
 * Web sources mirrored here (byte-for-byte semantics):
 * - `userHasCustodyViewPermission`
 *   (~/utils/permissions/custody-and-bookings-permissions.validator.client.ts:39-80):
 *   custody.read permission (ADMIN/OWNER) OR the org overrides
 *   `Organization.selfServiceCanSeeCustody` / `Organization.baseUserCanSeeCustody`.
 *   The identical server-side computation already exists in
 *   `requirePermission` (~/utils/roles.server.ts:113-122) as `canSeeAllCustody`.
 * - `userCanViewSpecificCustody` (same validator, lines 90-103): the
 *   custodian may ALWAYS see their own custody record.
 * - `QuantityCustodyList` (~/components/assets/quantity-custody-list.tsx:121-126):
 *   when the viewer can't see all custody, the list filters to the viewer's
 *   own rows and reports a hidden-count ("+N other people also have custody").
 *
 * Pure module (no db / heavy imports) so route tests can exercise the real
 * filtering logic while whole-module-mocking `mobile-auth.server`.
 *
 * @see {@link file://./mobile-auth.server.ts} — getMobileUserContext / getMobileAssetForViewer
 * @see {@link file://./../../routes/api+/mobile+/assets.$assetId.ts} — detail endpoint consumer
 */

import type { Organization } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";

/**
 * Computes whether a member may see ALL custody records in the organization.
 *
 * Mirrors the web's `canSeeAllCustody` in `requirePermission`
 * (~/utils/roles.server.ts:113-122) / `userHasCustodyViewPermission`:
 * ADMIN and OWNER always can; SELF_SERVICE and BASE only when the matching
 * org override is enabled.
 *
 * @param args.role - The viewer's role in the organization
 * @param args.organization - Org row with the two custody-visibility overrides
 * @returns true when the viewer may see every holder's custody
 */
export function computeCanSeeAllCustody({
  role,
  organization,
}: {
  role: OrganizationRoles;
  organization: Pick<
    Organization,
    "selfServiceCanSeeCustody" | "baseUserCanSeeCustody"
  >;
}): boolean {
  const isSelfServiceOrBase =
    role === OrganizationRoles.SELF_SERVICE || role === OrganizationRoles.BASE;

  return (
    // Admin/Owner always can see all
    !isSelfServiceOrBase ||
    // SELF_SERVICE can see all if org setting allows
    (role === OrganizationRoles.SELF_SERVICE &&
      organization.selfServiceCanSeeCustody) ||
    // BASE can see all if org setting allows
    (role === OrganizationRoles.BASE && organization.baseUserCanSeeCustody)
  );
}

/**
 * Filters a shaped `custodyList` down to what the viewer may see.
 *
 * Mirrors the web's `QuantityCustodyList` filter
 * (~/components/assets/quantity-custody-list.tsx:121-126): viewers without
 * custody-view permission only see their OWN entries; everyone else's are
 * replaced by a hidden-holders count so the client can render "+N others".
 *
 * The shaped list entries carry no `custodian.userId` (legacy contract), so
 * ownership is resolved from the raw custody rows (which the caller selects
 * WITH `custodian.userId`) and matched back by custodian id.
 *
 * @param args.custodyList - The shaped, per-custodian aggregated list
 * @param args.custodyRows - Raw custody rows carrying `custodian.userId`
 * @param args.viewerUserId - The authenticated caller's user id
 * @param args.canSeeAllCustody - Result of {@link computeCanSeeAllCustody}
 * @returns The visible list plus the count of hidden holders
 */
export function filterMobileCustodyListForViewer<
  TEntry extends { custodian: { id: string } },
>({
  custodyList,
  custodyRows,
  viewerUserId,
  canSeeAllCustody,
}: {
  custodyList: TEntry[];
  custodyRows: Array<{ custodian: { id: string; userId: string | null } }>;
  viewerUserId: string;
  canSeeAllCustody: boolean;
}): { custodyList: TEntry[]; custodyListOthersCount: number } {
  if (canSeeAllCustody) {
    return { custodyList, custodyListOthersCount: 0 };
  }

  // Custodian (TeamMember) ids that belong to the viewer. Normally at most
  // one per org, but the set keeps this robust to duplicates.
  const ownCustodianIds = new Set(
    custodyRows
      .filter((row) => row.custodian.userId === viewerUserId)
      .map((row) => row.custodian.id)
  );

  const visible = custodyList.filter((entry) =>
    ownCustodianIds.has(entry.custodian.id)
  );

  return {
    custodyList: visible,
    // The shaped list is aggregated per custodian, so each hidden entry is
    // exactly one hidden holder — matching the web's hiddenCount semantics.
    custodyListOthersCount: custodyList.length - visible.length,
  };
}

/**
 * Whether the viewer may see the legacy single `custody` field.
 *
 * Mirrors the web's `userCanViewSpecificCustody`
 * (~/utils/permissions/custody-and-bookings-permissions.validator.client.ts:90-103),
 * which the asset detail page applies to its single-custodian card:
 * `assets.$assetId.overview.tsx:1826-1836` passes
 * `hasPermission={userCanViewSpecificCustody(...)}` and `CustodyCard`
 * renders nothing when `!hasPermission` (asset-custody-card.tsx:63).
 *
 * @param args.custodianUserId - The custodian's linked user id (null for NRM)
 * @param args.viewerUserId - The authenticated caller's user id
 * @param args.canSeeAllCustody - Result of {@link computeCanSeeAllCustody}
 * @returns true when the legacy custody object may be included
 */
export function viewerCanSeeLegacyCustody({
  custodianUserId,
  viewerUserId,
  canSeeAllCustody,
}: {
  custodianUserId: string | null | undefined;
  viewerUserId: string;
  canSeeAllCustody: boolean;
}): boolean {
  // The custodian can always see their own custody
  if (custodianUserId && custodianUserId === viewerUserId) {
    return true;
  }

  return canSeeAllCustody;
}
