import type { Organization } from "@prisma/client";

export function isPersonalOrg(
  organization: Pick<Organization, "type"> | undefined
) {
  return organization?.type === "PERSONAL";
}
