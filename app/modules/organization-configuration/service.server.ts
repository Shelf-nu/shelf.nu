import type { OrganizationConfiguration } from "@prisma/client";
import { db } from "~/database/db.server";

export function updateOrganizationConfiguration({
  id,
  configuration,
}: {
  id: string;
  configuration: OrganizationConfiguration;
}) {
  return db.organizationConfiguration.update({
    where: { id },
    data: {
      ...configuration,
    },
  });
}
