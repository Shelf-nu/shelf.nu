import type { Kit, KitStatus, Prisma } from "@prisma/client";
import type { AllowedCustodianFilterIds } from "~/modules/asset/utils.server";
import { CUSTODY_FILTER_REFUSED } from "~/utils/custody-filter";

export function getKitsWhereInput({
  organizationId,
  currentSearchParams,
  allowedTeamMemberIds,
}: {
  organizationId: Kit["organizationId"];
  currentSearchParams?: string | null;
  /**
   * Required, with no default, so every call site states an answer. See the
   * twin parameter on `getAssetsWhereInput` — `?teamMember=` arrives on
   * `currentSearchParams` as raw request input, and a caller who may not see
   * all custody must not be able to filter a "select all" query by someone
   * else's id.
   */
  allowedTeamMemberIds: AllowedCustodianFilterIds;
}) {
  const where: Prisma.KitWhereInput = { organizationId };

  if (!currentSearchParams) {
    return where;
  }

  const searchParams = new URLSearchParams(currentSearchParams);

  const search = searchParams.get("s");
  const status =
    searchParams.get("status") === "ALL"
      ? null
      : (searchParams.get("status") as KitStatus);

  const requestedTeamMember = searchParams.get("teamMember"); // custodian
  const teamMember =
    !requestedTeamMember || allowedTeamMemberIds === "all"
      ? requestedTeamMember
      : // Refused rather than dropped: leaving it null would widen the query
      // back to every kit in the workspace.
      allowedTeamMemberIds.includes(requestedTeamMember)
      ? requestedTeamMember
      : CUSTODY_FILTER_REFUSED;

  if (search) {
    where.name = {
      contains: search.toLowerCase().trim(),
      mode: "insensitive",
    };
  }

  if (status) {
    where.status = status;
  }

  if (teamMember) {
    Object.assign(where, { custody: { custodianId: teamMember } });
  }

  return where;
}
