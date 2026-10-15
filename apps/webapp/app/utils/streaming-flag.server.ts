/**
 * Streaming hydration feature gate for the advanced-index rebuild.
 *
 * The streaming rebuild is opt-in per organization. Defaults OFF; enable an org
 * by adding its id to the comma-separated ADVANCED_INDEX_STREAMING_ORG_IDS env var.
 * Server-only.
 */

/**
 * Check if the streaming hydration rebuild is enabled for this organization.
 *
 * Reads the comma-separated list in ADVANCED_INDEX_STREAMING_ORG_IDS, trims
 * each id, ignores empties, and returns true iff the given organizationId
 * (exact match) is in the list. Unset/empty/whitespace-only env → false.
 *
 * @param organizationId - The organization's ID
 * @returns true if streaming is enabled for this org, false otherwise
 */
export function isStreamingEnabled(organizationId: string): boolean {
  const rawIds = process.env.ADVANCED_INDEX_STREAMING_ORG_IDS;

  // Unset, empty, or whitespace-only → false
  if (!rawIds || !rawIds.trim()) {
    return false;
  }

  const enabledIds = rawIds
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  return enabledIds.includes(organizationId);
}
