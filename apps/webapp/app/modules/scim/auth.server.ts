import { createHash, randomBytes } from "crypto";
import { db } from "~/database/db.server";
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
 * @throws {ScimError} 401 if the token is missing or invalid
 */
export async function authenticateScimRequest(
  request: Request
): Promise<{ organizationId: string }> {
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

  // Scope the write by the token's own organizationId (resolved above) so it
  // conforms to the org-scope IDOR convention for org-scoped tables and stays
  // robust to future refactors. Note the id here is already server-derived from
  // the secret token hash, so this is a defensive belt-and-suspenders, not a
  // guard against user-supplied ids.
  await db.scimToken.update({
    where: { id: scimToken.id, organizationId: scimToken.organizationId },
    data: { lastUsedAt: new Date() },
  });

  return { organizationId: scimToken.organizationId };
}
