/**
 * How much custody a team member holds.
 *
 * Custody comes in two independent shapes and a member can hold either without
 * the other, so anything deciding "is this member encumbered" has to count
 * both. Assigning a kit ALWAYS writes a `KitCustody` row, while the inherited
 * per-asset `Custody` rows are only written when the kit has assets to inherit
 * them — so the custodian of an empty kit holds no `custodies` at all and looks
 * unencumbered to anything counting only those.
 *
 * Deliberately dependency-free: this is read on the server when refusing a
 * delete and in the browser when rendering the row and its confirmation
 * dialog, and the two must agree.
 *
 * @see {@link file://./service.server.ts} deleteNRM, bulkDeleteNRMs
 * @see {@link file://./../../components/workspace/delete-member.tsx}
 */

/** The `_count` shape a team member row must select to be judged. */
export type TeamMemberCustodyCounts = {
  /** Per-asset custody rows, operator-assigned or inherited from a kit. */
  custodies: number;
  /** Kit-level custody rows, one per kit the member holds. */
  kitCustodies: number;
};

/**
 * Total custody a member holds, across both shapes.
 *
 * @param counts - The member's `_count` selection
 * @returns The combined count; `0` means the member can be deleted
 */
export function getHeldCustodyCount(counts: TeamMemberCustodyCounts): number {
  return counts.custodies + counts.kitCustodies;
}
