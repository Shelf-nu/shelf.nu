/**
 * SCIM request-body validation
 *
 * Zod schemas + a parse helper for the JSON bodies IdPs (Entra ID, Okta, …)
 * send to the SCIM endpoints. Validating here means malformed input surfaces
 * as a spec-compliant `400` SCIM error instead of an unhandled `500` from a
 * blind `as` cast downstream.
 *
 * The input TypeScript types (`ScimUserInput`, `ScimPatchOp`, …) are inferred
 * from these schemas so the runtime contract and the compile-time type never
 * drift apart. `types.ts` re-exports them for the rest of the module.
 *
 * All object schemas use `.passthrough()`: IdPs routinely send extra fields
 * (enterprise-user extensions, `meta`, provider-specific keys) that we neither
 * need nor want to reject — SCIM clients treat a `400` on an unknown attribute
 * as a hard provisioning failure.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./../../routes/api+/scim+/v2+/Users._index.ts}
 */
import { z } from "zod";
import { ScimError } from "./errors.server";

/** SCIM `name` sub-object (RFC 7643 §4.1.1). */
export const scimNameSchema = z
  .object({
    givenName: z.string().optional(),
    familyName: z.string().optional(),
    formatted: z.string().optional(),
  })
  .passthrough();

/** SCIM multi-valued `emails` entry (RFC 7643 §4.1.2). */
export const scimEmailSchema = z
  .object({
    value: z.string(),
    type: z.string().optional(),
    primary: z.boolean().optional(),
  })
  .passthrough();

/**
 * The body of a SCIM User POST (create) or PUT (replace).
 *
 * `userName` is optional at the schema level even though it is conceptually
 * required: some IdPs omit it and send the address in `emails[]` instead. The
 * service layer resolves the effective email from either source and returns a
 * `400` when neither is present.
 */
export const scimUserInputSchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    externalId: z.string().optional(),
    userName: z.string().optional(),
    name: scimNameSchema.optional(),
    displayName: z.string().optional(),
    emails: z.array(scimEmailSchema).optional(),
    active: z.boolean().optional(),
  })
  .passthrough();

/**
 * A single SCIM PATCH operation (RFC 7644 §3.5.2).
 *
 * `op` is kept as a free `string` (not an enum) on purpose: Entra ID sends
 * title-cased ops ("Replace", "Add"), so case-insensitive handling happens in
 * the service rather than being rejected here.
 */
export const scimPatchOperationSchema = z
  .object({
    op: z.string(),
    path: z.string().optional(),
    value: z.unknown().optional(),
  })
  .passthrough();

/** The body of a SCIM PATCH request (RFC 7644 §3.5.2). */
export const scimPatchOpSchema = z
  .object({
    schemas: z.array(z.string()).optional(),
    Operations: z.array(scimPatchOperationSchema),
  })
  .passthrough();

export type ScimName = z.infer<typeof scimNameSchema>;
export type ScimEmailInput = z.infer<typeof scimEmailSchema>;
export type ScimUserInput = z.infer<typeof scimUserInputSchema>;
export type ScimPatchOperation = z.infer<typeof scimPatchOperationSchema>;
export type ScimPatchOp = z.infer<typeof scimPatchOpSchema>;

/**
 * Reads and validates a SCIM JSON request body against a schema.
 *
 * @param request - The incoming request
 * @param schema - The Zod schema to validate the parsed body against
 * @returns The validated, typed body
 * @throws {ScimError} 400 `invalidSyntax` when the body is not valid JSON
 * @throws {ScimError} 400 `invalidValue` when the body fails schema validation
 */
export async function parseScimJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ScimError("Request body is not valid JSON", 400, "invalidSyntax");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
      .join("; ");
    throw new ScimError(`Invalid SCIM payload: ${detail}`, 400, "invalidValue");
  }

  return result.data;
}
