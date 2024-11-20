import { z } from "zod";
import { isRouteError } from "~/utils/http";

export const specialErrorAdditionalData = z.object({
  model: z.enum(["assets"]),
  id: z.string(),
  organization: z.object({
    organization: z.object({
      id: z.string(),
      name: z.string(),
    }),
  }),
});

export type SpecialErrorAdditionalData = z.infer<
  typeof specialErrorAdditionalData
>;

export function parseSpecialErrorData(response: unknown):
  | { success: false; additionalData: null }
  | {
      success: true;
      additionalData: SpecialErrorAdditionalData;
    } {
  if (!isRouteError(response)) {
    return { success: false, additionalData: null };
  }

  const parsedDataResponse = specialErrorAdditionalData.safeParse(
    response.data.error.additionalData
  );

  if (!parsedDataResponse.success) {
    return { success: false, additionalData: null };
  }

  return { success: true, additionalData: parsedDataResponse.data };
}
