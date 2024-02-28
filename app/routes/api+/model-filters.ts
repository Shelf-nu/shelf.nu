import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database";
import { requireOrganisationId } from "~/modules/organization/context.server";

export type AllowedModelNames = "asset" | "tag" | "category" | "location";

const ModelFiltersSchema = z.object({
  /** Models that are allowed to filter */
  model: z.enum(["asset", "tag", "category"]),

  /** key of field for which we have to filter values */
  queryKey: z.string(),

  /** Actual value */
  queryValue: z.string(),

  /** What user have already selected, so that we can exclude them */
  selectedValues: z.string().optional(),
});

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { organizationId } = await requireOrganisationId({ userId, request });

  /** Getting all the query parameters from url */
  const url = new URL(request.url);
  const data: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    data[key] = value;
  }

  /** Validating parameters */
  const result = await ModelFiltersSchema.safeParseAsync(data);
  if (!result.success) {
    return json({ errors: result.error }, { status: 400 });
  }

  const model = result.data.model as AllowedModelNames;
  const queryData = (await db[model].dynamicFindMany({
    where: {
      organizationId,
      OR: [
        {
          [result.data.queryKey]: {
            contains: result.data.queryValue,
            mode: "insensitive",
          },
        },
        {
          id: { in: (result.data.selectedValues ?? "").split(",") },
        },
      ],
    },
    take: 4,
  })) as Array<Record<string, string>>;

  return json(
    queryData.map((item) => ({
      id: item.id,
      name: item[result.data.queryKey],
      color: item?.color,
      metadata: item,
    }))
  );
}
