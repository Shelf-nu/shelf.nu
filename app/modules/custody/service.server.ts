import type { Asset, TeamMember } from "@prisma/client";
import { db } from "~/database";

export const setCustody = async ({
  assetId,
  teamMemberId,
}: {
  assetId: Asset["id"];
  teamMemberId: TeamMember["id"];
}) => {
  const [asset, teamMember] = await db.$transaction([
    /** Get the assets */
    db.asset.findUnique({
      where: { id: assetId },
    }),

    /** Count them */
    db.teamMember.findUnique({
      where: { id: teamMemberId },
    }),
  ]);

  return null;
};
