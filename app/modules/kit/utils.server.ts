import type { Kit, KitStatus, Prisma } from "@prisma/client";

export function getKitsWhereInput({
  organizationId,
  currentSearchParams,
}: {
  organizationId: Kit["organizationId"];
  currentSearchParams?: string | null;
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

  const teamMember = searchParams.get("teamMember"); // custodian

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
