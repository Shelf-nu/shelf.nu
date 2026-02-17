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

  // Update lastUsedAt (fire-and-forget, don't block the request)
  void db.scimToken.update({
    where: { id: scimToken.id },
    data: { lastUsedAt: new Date() },
  });

  return { organizationId: scimToken.organizationId };
}
