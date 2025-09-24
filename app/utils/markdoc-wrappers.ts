/**
 * Utility for wrapping dates in Markdoc tags for dynamic formatting in notes
 *
 * This allows us to store dates in note content that get dynamically formatted
 * based on the viewer's timezone and locale when rendered using Markdoc's
 * custom date component.
 */

/**
 * Wraps a date in Markdoc date tag syntax for proper rendering
 *
 * @param date - Date object or ISO string to wrap
 * @param includeTime - Whether to include time in the rendered output (default: true)
 * @returns String with date wrapped in Markdoc tag syntax
 *
 * Example: wrapDateForNote(new Date()) -> "{% date value=\"2023-12-25T10:30:00.000Z\" /%}"
 */
export function wrapDateForNote(
  date: Date | string,
  includeTime: boolean = true
): string {
  const isoString = typeof date === "string" ? date : date.toISOString();
  const includeTimeAttr = includeTime ? "" : " includeTime=false";
  return `{% date value="${isoString}"${includeTimeAttr} /%}`;
}

/**
 * Regular expression to match Markdoc date tags in note content
 * Matches: {% date value="2023-12-25T10:30:00.000Z" /%} or {% date value="..." includeTime=false /%}
 */
export const DATE_TAG_REGEX =
  /{%\s*date\s+value="([^"]+)"(?:\s+includeTime=(true|false))?\s*\/%}/g;

/**
 * Extracts date strings from Markdoc date tags in content
 *
 * @param content - Note content that may contain Markdoc date tags
 * @returns Array of ISO date strings found in the content
 */
export function extractDateTags(content: string): string[] {
  const matches = content.matchAll(DATE_TAG_REGEX);
  return Array.from(matches, (match) => match[1]);
}

/**
 * Wraps asset information in Markdoc assets_list tag syntax for interactive display
 *
 * @param assetIds - Array of asset IDs or single asset ID
 * @param action - Action performed on the assets (e.g., "added", "removed")
 * @returns String with assets wrapped in Markdoc tag syntax
 *
 * Example: wrapAssetsForNote(["id1", "id2"], "added") -> "{% assets_list count=2 ids=\"id1,id2\" action=\"added\" /%}"
 */
export function wrapAssetsForNote(
  assetIds: string[] | string,
  action: string = "added"
): string {
  const ids = Array.isArray(assetIds) ? assetIds : [assetIds];
  const count = ids.length;
  const idsString = ids.join(",");

  return `{% assets_list count=${count} ids="${idsString}" action="${action}" /%}`;
}

/**
 * Wraps kit information in Markdoc kits_list tag syntax for interactive display
 *
 * @param kitIds - Array of kit IDs or single kit ID
 * @param action - Action performed on the kits (e.g., "added", "removed")
 * @returns String with kits wrapped in Markdoc tag syntax
 *
 * Example: wrapKitsForNote(["id1", "id2"], "added") -> "{% kits_list count=2 ids=\"id1,id2\" action=\"added\" /%}"
 */
export function wrapKitsForNote(
  kitIds: string[] | string,
  action: string = "added"
): string {
  const ids = Array.isArray(kitIds) ? kitIds : [kitIds];
  const count = ids.length;
  const idsString = ids.join(",");

  return `{% kits_list count=${count} ids="${idsString}" action="${action}" /%}`;
}

/**
 * Wraps kit information with actual kit data to avoid loading flash for single items
 *
 * @param kits - Array of kit objects with id and name, or single kit object
 * @param action - Action performed on the kits (e.g., "added", "removed")
 * @returns String with appropriate format based on count
 *
 * For single kit: Direct link with name
 * For multiple kits: Interactive component with popover
 */
export function wrapKitsWithDataForNote(
  kits: Array<{ id: string; name: string }> | { id: string; name: string },
  action: string = "added"
): string {
  const kitArray = Array.isArray(kits) ? kits : [kits];
  const count = kitArray.length;

  if (count === 1) {
    // For single kit, create direct link to avoid loading flash
    const kit = kitArray[0];
    return `**[${kit.name}](/kits/${kit.id})**`;
  } else {
    // For multiple kits, use interactive component
    const idsString = kitArray.map((k) => k.id).join(",");
    return `{% kits_list count=${count} ids="${idsString}" action="${action}" /%}`;
  }
}

/**
 * Wraps asset information with actual asset data to avoid loading flash for single items
 *
 * @param assets - Array of asset objects with id and title, or single asset object
 * @param action - Action performed on the assets (e.g., "added", "removed")
 * @returns String with appropriate format based on count
 *
 * For single asset: Direct link with title
 * For multiple assets: Interactive component with popover
 */
export function wrapAssetsWithDataForNote(
  assets: Array<{ id: string; title: string }> | { id: string; title: string },
  action: string = "added"
): string {
  const assetArray = Array.isArray(assets) ? assets : [assets];
  const count = assetArray.length;

  if (count === 1) {
    // For single asset, create direct link to avoid loading flash
    const asset = assetArray[0];
    return `**[${asset.title}](/assets/${asset.id})**`;
  } else {
    // For multiple assets, use interactive component
    const idsString = assetArray.map((a) => a.id).join(",");
    return `{% assets_list count=${count} ids="${idsString}" action="${action}" /%}`;
  }
}

/**
 * Creates a consistent user link for notes using Markdoc link tag
 *
 * @param user - User object with id, firstName, and lastName
 * @returns String with link tag in Markdoc format
 *
 * Example: wrapUserLinkForNote({id: "123", firstName: "John", lastName: "Doe"})
 * -> "{% link to=\"/settings/team/users/123\" text=\"John Doe\" /%}"
 */
export function wrapUserLinkForNote(user: {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const fullName = `${user.firstName?.trim() || ""} ${
    user.lastName?.trim() || ""
  }`.trim();
  const displayName = fullName || "Unknown User";
  return `{% link to="/settings/team/users/${user.id}" text="${displayName}" /%}`;
}

/**
 * Creates a generic link for notes using Markdoc link tag
 *
 * @param to - URL path for the link
 * @param text - Display text for the link
 * @returns String with link tag in Markdoc format
 *
 * Example: wrapLinkForNote("/bookings/123", "My Booking")
 * -> "{% link to=\"/bookings/123\" text=\"My Booking\" /%}"
 */
export function wrapLinkForNote(to: string, text: string): string {
  return `{% link to="${to}" text="${text}" /%}`;
}

/**
 * Regular expression to match Markdoc assets_list tags in note content
 * Matches: {% assets_list count=3 ids="id1,id2,id3" action="added" /%}
 */
export const ASSETS_LIST_TAG_REGEX =
  /{%\s*assets_list\s+count=(\d+)\s+ids="([^"]+)"\s+action="([^"]+)"\s*\/%}/g;

/**
 * Extracts asset list information from Markdoc assets_list tags in content
 *
 * @param content - Note content that may contain Markdoc assets_list tags
 * @returns Array of objects with count, ids, and action information
 */
export function extractAssetsListTags(content: string): Array<{
  count: number;
  ids: string[];
  action: string;
}> {
  const matches = content.matchAll(ASSETS_LIST_TAG_REGEX);
  return Array.from(matches, (match) => ({
    count: parseInt(match[1], 10),
    ids: match[2].split(","),
    action: match[3],
  }));
}
