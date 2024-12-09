import { z } from "zod";
import { isRouteError } from "~/utils/http";

/**
 * Base schema for additional error data.
 * Contains common fields used across different error types.
 */
const baseAdditionalDataSchema = z.object({
  /** Unique identifier for the error instance */
  id: z.string(),
  /** Optional URL to redirect the user to after error handling */
  redirectTo: z.string().optional(),
});

/**
 * Schema defining organization structure used in error data
 */
const organizationSchema = z.object({
  organization: z.object({
    /** Organization's unique identifier */
    id: z.string(),
    /** Organization's display name */
    name: z.string(),
  }),
});

/**
 * Schema for 404 error additional data.
 * Uses a discriminated union to handle different model types with specific requirements.
 */
export const error404AdditionalDataSchema = z.discriminatedUnion("model", [
  /* For common and general use case */
  baseAdditionalDataSchema.extend({
    /** Type of resource that wasn't found */
    model: z.enum(["asset", "kit", "location", "booking", "customField"]),
    /** Organization context where the resource wasn't found */
    organization: organizationSchema,
  }),
  /* A team member (user) can be in multiple organization's of user so we do this. */
  baseAdditionalDataSchema.extend({
    /** Specific case for team member not found errors */
    model: z.literal("teamMember"),
    /** List of organizations the team member could belong to */
    organizations: organizationSchema.array(),
  }),
]);

/**
 * Type definition for the 404 error additional data structure
 */
export type Error404AdditionalData = z.infer<
  typeof error404AdditionalDataSchema
>;

/**
 * Parses and validates the structure of a 404 error response.
 *
 * @param response - The unknown response to be parsed
 * @returns An object indicating whether it's a valid 404 error and its additional data
 *          If it's not a valid 404 error or parsing fails, returns {isError404: false, additionalData: null}
 *          If it's a valid 404 error, returns {isError404: true, additionalData: Error404AdditionalData}
 */
export function parse404ErrorData(
  response: unknown
):
  | { isError404: false; additionalData: null }
  | { isError404: true; additionalData: Error404AdditionalData } {
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

/**
 * Converts a model enum value to a human-readable label.
 *
 * @param model - The model type from Error404AdditionalData
 * @returns A string representing the human-readable label for the model
 */
export function getModelLabelForEnumValue(
  model: Error404AdditionalData["model"]
): string {
  if (model === "customField") {
    return "Custom field";
  }
  return model;
}
