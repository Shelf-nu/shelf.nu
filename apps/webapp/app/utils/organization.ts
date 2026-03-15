import type { Organization } from "@shelf/database";

export function isPersonalOrg(
  organization: Pick<Organization, "type"> | undefined
) {
  return organization?.type === "PERSONAL";
}
