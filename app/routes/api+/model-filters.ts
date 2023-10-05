import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";

export type AllowedModelNames = "asset" | "tag" | "category";

const ModelFiltersSchema = z.object({
  /** Models that are allowed to filter */
  model: z.enum(["asset", "tag", "category"]),

  /** key of field for which we have to filter values */
  queryKey: z.string(),

  /** Actual value */
  queryValue: z.string(),
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

  const model = result.data.model as AllowedModelNames;
  const queryData = (await db[model].dynamicFindMany({
    where: {
      [result.data.queryKey]: {
        contains: result.data.queryValue,
        mode: "insensitive",
      },
      userId,
    },
    take: 4,
  })) as Array<Record<string, string>>;

  return json(
    queryData.map((item) => ({
      id: item.id,
      name: item[result.data.queryKey],
      color: item?.color,
    }))
  );
}
