import type { Prisma } from "@prisma/client";
import type { DefaultArgs } from "@prisma/client/runtime/library";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";

export type AllowedModelNames = "asset" | "tag" | "category" | "location";
type ModelMap = {
  asset: Prisma.AssetDelegate<any>;
  tag: Prisma.TagDelegate<any>;
  category: Prisma.CategoryDelegate<any>;
  location: Prisma.LocationDelegate<any>;
};
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId } = await requireAuthSession(request);

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

  const model = result.data.model as keyof ModelMap;
  const delegate = db[model] as ModelMap[typeof model] & {
    dynamicFindMany: typeof db.$allModels.dynamicFindMany;
  };
  const queryData = (await delegate.dynamicFindMany({
    where: {
      userId,
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
  })) as Array<any>;

  return json(
    queryData.map((item) => ({
      id: item.id,
      name: item[result.data.queryKey],
      color: item?.color,
      metadata: item,
    }))
  );
}
