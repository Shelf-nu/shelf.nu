import type { Organization, Prisma, TeamMember } from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

export async function createTeamMember({
  name,
  organizationId,
}: {
  name: TeamMember["name"];
  organizationId: Organization["id"];
}) {
  return db.teamMember.create({
    data: {
      name,
      organization: {
        connect: {
          id: organizationId,
        },
      },
    },
  });
}

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
    const existingTeamMember = await db.teamMember.findFirst({
      where: {
        deletedAt: null,
        name: teamMember,
        organizationId,
      },
    });

    if (!existingTeamMember) {
      // if the teamMember doesn't exist, we create a new one
      const newTeamMember = await createTeamMember({
        name: teamMember as string,
        organizationId,
      });
      teamMembers.set(teamMember, newTeamMember.id);
    } else {
      // if the teamMember exists, we just update the id
      teamMembers.set(teamMember, existingTeamMember.id);
    }
  }

  return Object.fromEntries(Array.from(teamMembers));
}

export async function getTeamMembers({
  organizationId,
  page = 1,
  perPage = 8,
  search,
}: {
  organizationId: Organization["id"];

  /** Page number. Starts at 1 */
  page: number;

  /** Assets to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the assetss belonging to current user */
  let where: Prisma.TeamMemberWhereInput = {
    deletedAt: null,
    organizationId,
  };

  /** If the search string exists, add it to the where object */
  if (search) {
    where.name = {
      contains: search,
      mode: "insensitive",
    };
  }

  const [teamMembers, totalTeamMembers] = await db.$transaction([
    /** Get the assets */
    db.teamMember.findMany({
      skip,
      take,
      where,
      orderBy: { createdAt: "desc" },
      include: {
        custodies: true,
      },
    }),

    /** Count them */
    db.teamMember.count({ where }),
  ]);

  return { teamMembers, totalTeamMembers };
}
export const getPaginatedAndFilterableTeamMembers = async ({
  request,
  organizationId,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  const { teamMembers, totalTeamMembers } = await getTeamMembers({
    organizationId,
    page,
    perPage,
    search,
  });
  const totalPages = Math.ceil(totalTeamMembers / perPage);

  return {
    page,
    perPage,
    search,
    prev,
    next,
    teamMembers,
    totalPages,
    totalTeamMembers,
    cookie,
  };
};
