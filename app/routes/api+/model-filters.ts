import type { Prisma } from "@prisma/client";
import { json, type LoaderArgs } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";

type ModelNames = Uncapitalize<Prisma.ModelName>;

const ModelFiltersSchema = z.object({
  /** Models that are allowed to filter */
  model: z.enum(["asset", "tag", "category"]),

  /** key of field for which we have to filter values */
  queryKey: z.string(),

  /** Actual value */
  queryValue: z.string(),
});

export async function loader({ request }: LoaderArgs) {
  await requireAuthSession(request);

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

  const model = result.data.model as ModelNames;
  const queryData = (await db[model].dynamicFindMany(
    result.data.queryKey,
    result.data.queryValue
  )) as Array<Record<string, string>>;

  return json(
    queryData.map((item) => ({
      id: item.id,
      [result.data.queryKey]: item[result.data.queryKey],
    }))
  );
}
