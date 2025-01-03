import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getSelectedOrganisation } from "~/modules/organization/context.server";
import { makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";

const BasicModelFilters = z.object({
  /** key of field for which we have to filter values */
  queryKey: z.string(),

  /** Actual value */
  queryValue: z.string().optional(),

  /** What user have already selected, so that we can exclude them */
  selectedValues: z.string().optional(),
});

/**
 * The schema used for each different model.
 * To allow filtersing and searching on different models update the schema for the relevant model
 */
export const ModelFiltersSchema = z.discriminatedUnion("name", [
  BasicModelFilters.extend({
    name: z.literal("asset"),
  }),
  BasicModelFilters.extend({
    name: z.literal("tag"),
  }),
  BasicModelFilters.extend({
    name: z.literal("category"),
  }),
  BasicModelFilters.extend({
    name: z.literal("location"),
  }),
  BasicModelFilters.extend({
    name: z.literal("kit"),
  }),
  BasicModelFilters.extend({
    name: z.literal("teamMember"),
    deletedAt: z.string().nullable().optional(),
    userWithAdminAndOwnerOnly: z.coerce.boolean().optional(), // To get only the teamMembers which are admin or owner
  }),
  BasicModelFilters.extend({
    name: z.literal("booking"),
  }),
]);

export type AllowedModelNames = z.infer<typeof ModelFiltersSchema>["name"];
export type ModelFilters = z.infer<typeof ModelFiltersSchema>;
export type ModelFiltersLoader = typeof loader;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await getSelectedOrganisation({
      userId,
      request,
    });

    /** Getting all the query parameters from url */
    const url = new URL(request.url);
    const searchParams: Record<string, any> = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (value === "null") {
        searchParams[key] = null;
      } else {
        searchParams[key] = value;
      }
    }

    /** Validating parameters */
    const modelFilters = parseData(searchParams, ModelFiltersSchema);
    const { name, queryKey, queryValue, selectedValues } = modelFilters;

    const where: Record<string, any> = {
      organizationId,
      OR: [{ id: { in: (selectedValues ?? "").split(",") } }],
    };
    /**
     * When searching for teamMember, we have to search for
     * - teamMember's name
     * - teamMember's user firstName, lastName and email
     */
    if (modelFilters.name === "teamMember") {
      where.OR.push(
        { name: { contains: queryValue, mode: "insensitive" } },
        { user: { firstName: { contains: queryValue, mode: "insensitive" } } },
        { user: { firstName: { contains: queryValue, mode: "insensitive" } } },
        { user: { email: { contains: queryValue, mode: "insensitive" } } }
      );

      where.deletedAt = modelFilters.deletedAt;
      if (modelFilters.userWithAdminAndOwnerOnly) {
        where.AND = [
          { user: { isNot: null } },
          {
            user: {
              userOrganizations: {
                some: {
                  AND: [
                    { organizationId },
                    { roles: { hasSome: ["ADMIN", "OWNER"] } },
                  ],
                },
              },
            },
          },
        ];
      }
    } else {
      where.OR.push({
        [queryKey]: { contains: queryValue, mode: "insensitive" },
      });
    }

    const queryData = (await db[name].dynamicFindMany({
      where,
      include:
        /** We need user's information to resolve teamMember's name */
        name === "teamMember"
          ? {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            }
          : undefined,
    })) as Array<Record<string, string>>;

    return json(
      data({
        filters: queryData.map((item) => ({
          id: item.id,
          name: item[queryKey],
          color: item?.color,
          metadata: item,
          user: item?.user as any,
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
