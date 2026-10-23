/**
 * Minimal SCIM filter parser for the subset of filters Entra ID uses.
 *
 * Supports:
 *   userName eq "user@example.com"
 *   externalId eq "some-entra-id"
 */

export interface ScimFilter {
  attribute: string;
  operator: string;
  value: string;
}

/**
 * Parses a SCIM filter string into a structured filter object.
 * Returns null if the filter string doesn't match the expected pattern.
 *
 * Only supports simple `attribute op "value"` expressions — compound
 * filters (and/or) are not supported since Entra ID doesn't use them
 * for user provisioning.
 */
export function parseScimFilter(filterString: string): ScimFilter | null {
  const match = filterString.match(
    /^(\w+(?:\.\w+)?)\s+(eq|ne|co|sw|ew|gt|lt|ge|le)\s+"([^"]*)"$/i
  );
  if (!match) {
    return null;
  }

  return {
    attribute: match[1].toLowerCase(),
    operator: match[2].toLowerCase(),
    value: match[3],
  };
}
