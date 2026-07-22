import { createHash, randomBytes } from "crypto";
import { config } from "~/config/shelf.config";
import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";
import { ScimError } from "./errors.server";

/**
 * Generates a SCIM bearer token pair.
 * The raw token is returned for display to the admin (shown once).
 * The tokenHash is stored in the database.
 */
export function generateScimToken(): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Authenticates a SCIM request by validating the Bearer token.
 * Returns the organization ID the token is scoped to.
 *
 * This is the single chokepoint for every SCIM route (`Users`, `Users/{id}`,
 * `ServiceProviderConfig`, `ResourceTypes`, `Schemas`), so it is also where the
 * `ENABLE_SCIM` feature flag is enforced.
 *
 * @throws {ScimError} 404 if SCIM is not enabled on this deployment
 * @throws {ScimError} 401 if the token is missing or invalid
 */
export async function authenticateScimRequest(
  request: Request
): Promise<{ organizationId: string }> {
  // Checked before the header is read and before any DB access, so a deployment
  // with SCIM disabled does no work at all on these paths. 404 (not 403) so a
  // disabled instance is indistinguishable from one that never exposed the
  // endpoint, and so the response can't hint that a token might be valid.
  if (!config.enableScim) {
    throw new ScimError(
      "SCIM provisioning is not enabled on this instance",
      404
    );
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new ScimError("Authentication required", 401);
  }

  const rawToken = authHeader.slice(7);
  const tokenHash = hashToken(rawToken);

  const scimToken = await db.scimToken.findUnique({
    where: { tokenHash },
    select: { id: true, organizationId: true },
  });

  if (!scimToken) {
    throw new ScimError("Invalid token", 401);
  }

  // `lastUsedAt` is observability, not authentication state — nothing downstream
  // reads it during the request. Deliberately NOT awaited so a transient write
  // failure can't turn a valid provisioning call into a 500, and so IdP requests
  // aren't paced by a second round-trip. The rejection is swallowed and logged;
  // leaving the promise unhandled would crash the process.
  //
  // The write is scoped by the token's own organizationId (resolved above) to
  // follow the org-scope IDOR convention for org-scoped tables. The id is
  // already server-derived from the secret token hash, so that scoping is
  // belt-and-braces rather than a guard against user-supplied ids.
  void db.scimToken
    .update({
      where: { id: scimToken.id, organizationId: scimToken.organizationId },
      data: { lastUsedAt: new Date() },
    })
    .catch((cause: unknown) => {
      Logger.warn(
        "Failed to record SCIM token lastUsedAt",
        scimToken.id,
        scimToken.organizationId,
        cause
      );
    });

  return { organizationId: scimToken.organizationId };
}
