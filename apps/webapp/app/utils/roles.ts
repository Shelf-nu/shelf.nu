import { OrganizationRoles } from "@prisma/client";

const ROLE_RANK: Record<OrganizationRoles, number> = {
  [OrganizationRoles.OWNER]: 3,
  [OrganizationRoles.ADMIN]: 2,
  // Rank 1 on purpose: a booking manager operates bookings but cannot own or
  // manage catalog entities, so ADMIN -> BOOKING_MANAGER is a demotion and
  // triggers the created-entities transfer flow in the change-role dialog.
  [OrganizationRoles.BOOKING_MANAGER]: 1,
  [OrganizationRoles.SELF_SERVICE]: 1,
  [OrganizationRoles.BASE]: 1,
};

/**
 * Determines whether changing from `current` to `next` is a demotion.
 * A demotion means the new role has a lower rank than the current role.
 */
export function isDemotion(
  current: OrganizationRoles,
  next: OrganizationRoles
): boolean {
  return ROLE_RANK[current] > ROLE_RANK[next];
}
