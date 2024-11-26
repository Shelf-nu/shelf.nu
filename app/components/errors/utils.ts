import { z } from "zod";
import { isRouteError } from "~/utils/http";

const baseAdditionalDataSchema = z.object({
  id: z.string(),
  redirectTo: z.string().optional(),
});

const organizationSchema = z.object({
  organization: z.object({
    id: z.string(),
    name: z.string(),
  }),
});

export const error404AdditionalDataSchema = z.discriminatedUnion("model", [
  /* For common and general use case */
  baseAdditionalDataSchema.extend({
    model: z.enum(["asset", "kit", "location"]),
    organization: organizationSchema,
  }),
  /* A team member (user) can be in multiple organization's of user so we do this. */
  baseAdditionalDataSchema.extend({
    model: z.literal("teamMember"),
    organizations: organizationSchema.array(),
  }),
]);

export type Error404AdditionalData = z.infer<
  typeof error404AdditionalDataSchema
>;

export function parse404ErrorData(response: unknown):
  | { isError404: false; additionalData: null }
  | {
      isError404: true;
      additionalData: Error404AdditionalData;
    } {
  if (!isRouteError(response)) {
    return { isError404: false, additionalData: null };
  }

  const parsedDataResponse = error404AdditionalDataSchema.safeParse(
    response.data.error.additionalData
  );

  if (!parsedDataResponse.success) {
    return { isError404: false, additionalData: null };
  }

  return { isError404: true, additionalData: parsedDataResponse.data };
}
