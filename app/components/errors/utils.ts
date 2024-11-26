import { z } from "zod";
import { isRouteError } from "~/utils/http";

export const error404AdditionalData = z.object({
  model: z.enum(["asset", "kit", "location"]),
  id: z.string(),
  redirectTo: z.string().optional(),
  organization: z.object({
    organization: z.object({
      id: z.string(),
      name: z.string(),
    }),
  }),
});

export type Error404AdditionalData = z.infer<typeof error404AdditionalData>;

export function parse404ErrorData(response: unknown):
  | { isError404: false; additionalData: null }
  | {
      isError404: true;
      additionalData: Error404AdditionalData;
    } {
  if (!isRouteError(response)) {
    return { isError404: false, additionalData: null };
  }

  const parsedDataResponse = error404AdditionalData.safeParse(
    response.data.error.additionalData
  );

  if (!parsedDataResponse.success) {
    return { isError404: false, additionalData: null };
  }

  return { isError404: true, additionalData: parsedDataResponse.data };
}
