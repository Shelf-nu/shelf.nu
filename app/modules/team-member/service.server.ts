import type { Organization, TeamMember } from "@prisma/client";
import { db } from "~/database";
import type { CreateAssetFromContentImportPayload } from "../asset";

export async function createTeamMemberIfNotExists({
  data,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  organizationId: Organization["id"];
}): Promise<Record<string, TeamMember["id"]>> {
  // first we get all the teamMembers from the assets and make then into an object where the category is the key and the value is an empty string
  /**
   * Important note: The field in the csv is called "custodian" for making it easy for the user
   * However in the app it works a bit different due to how the relationships are
   */
  const teamMembers = new Map(
    data
      .filter((asset) => asset.custodian !== "")
      .map((asset) => [asset.custodian, ""])
  );

  // now we loop through the categories and check if they exist
  for (const [teamMember, _] of teamMembers) {
    console.log("teamMember", teamMember);
    const existingTeamMember = await db.teamMember.findFirst({
      where: {
        name: teamMember,
        organizations: { some: { id: organizationId } },
      },
    });
    console.log("existingTeamMember", existingTeamMember);

    if (!existingTeamMember) {
      // if the teamMember doesn't exist, we create a new one
      const newTeamMember = await db.teamMember.create({
        data: {
          name: teamMember as string,
          organizations: {
            connect: {
              id: organizationId,
            },
          },
        },
      });
      teamMembers.set(teamMember, newTeamMember.id);
    } else {
      // if the teamMember exists, we just update the id
      teamMembers.set(teamMember, existingTeamMember.id);
    }
  }

  return Object.fromEntries(Array.from(teamMembers));
}
