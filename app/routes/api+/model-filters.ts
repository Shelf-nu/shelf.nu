import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database";
import { getSelectedOrganisation } from "~/modules/organization/context.server";
import { data, error, makeShelfError, parseData } from "~/utils";

const ModelFiltersSchema = z.object({
  /** Models that are allowed to filter */
  model: z.enum(["asset", "tag", "category", "location"]),

  /** key of field for which we have to filter values */
  queryKey: z.string(),

  /** Actual value */
  queryValue: z.string(),

  /** What user have already selected, so that we can exclude them */
  selectedValues: z.string().optional(),
});

export type AllowedModelNames = z.infer<typeof ModelFiltersSchema>["model"];

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
    const searchParams: Record<string, string> = {};
    for (const [key, value] of url.searchParams.entries()) {
      searchParams[key] = value;
    }

    /** Validating parameters */
    const { model, queryKey, queryValue, selectedValues } = parseData(
      searchParams,
      ModelFiltersSchema
    );

    const queryData = (await db[model].dynamicFindMany({
      where: {
        organizationId,
        OR: [
          {
            [queryKey]: {
              contains: queryValue,
              mode: "insensitive",
            },
          },
          {
            id: { in: (selectedValues ?? "").split(",") },
          },
        ],
      },
    })) as Array<Record<string, string>>;

    return json(
      data({
        filters: queryData.map((item) => ({
          id: item.id,
          name: item[queryKey],
          color: item?.color,
          metadata: item,
        })),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
