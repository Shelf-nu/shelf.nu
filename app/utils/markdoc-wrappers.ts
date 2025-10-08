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
 * Wraps asset information with actual asset data (preferred method)
 *
 * @param assets - Array of asset objects with id and title, or single asset object
 * @param action - Action performed on the assets (e.g., "added", "removed")
 * @returns String with appropriate format based on count
 *
 * For single asset: Direct link with title (e.g., "Canon Camera")
 * For multiple assets: Interactive component with popover (e.g., "3 assets")
 */
export function wrapAssetsWithDataForNote(
  assets: Array<{ id: string; title: string }> | { id: string; title: string },
  action: string = "added"
): string {
  const assetArray = Array.isArray(assets) ? assets : [assets];
  const count = assetArray.length;

  if (count === 1) {
    // For single asset, use link tag to ensure proper styling and new tab behavior
    const asset = assetArray[0];
    return `{% link to="/assets/${asset.id}" text="${asset.title.replace(
      /"/g,
      "&quot;"
    )}" /%}`;
  } else {
    // For multiple assets, use interactive component
    const idsString = assetArray.map((a) => a.id).join(",");
    return `{% assets_list count=${count} ids="${idsString}" action="${action.replace(
      /"/g,
      "&quot;"
    )}" /%}`;
  }
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

  return `{% kits_list count=${count} ids="${idsString}" action="${action.replace(
    /"/g,
    "&quot;"
  )}" /%}`;
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
    // For single kit, use link tag to ensure proper styling and new tab behavior
    const kit = kitArray[0];
    return `{% link to="/kits/${kit.id}" text="${kit.name.replace(
      /"/g,
      "&quot;"
    )}" /%}`;
  } else {
    // For multiple kits, use interactive component
    const idsString = kitArray.map((k) => k.id).join(",");
    return `{% kits_list count=${count} ids="${idsString}" action="${action.replace(
      /"/g,
      "&quot;"
    )}" /%}`;
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
  return `{% link to="/settings/team/users/${
    user.id
  }" text="${displayName.replace(/"/g, "&quot;")}" /%}`;
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
  return `{% link to="${to}" text="${text.replace(/"/g, "&quot;")}" /%}`;
}

/**
 * Wraps booking status in Markdoc booking_status tag syntax for consistent display
 *
 * @param status - Booking status (DRAFT, RESERVED, ONGOING, etc.)
 * @param custodianUserId - Optional custodian user ID for extra tooltip info
 * @returns String with booking status wrapped in Markdoc tag syntax
 *
 * Example: wrapBookingStatusForNote("RESERVED", "user123")
 * -> "{% booking_status status=\"RESERVED\" custodianUserId=\"user123\" /%}"
 */
export function wrapBookingStatusForNote(
  status: string,
  custodianUserId?: string
): string {
  const custodianAttr = custodianUserId
    ? ` custodianUserId="${custodianUserId}"`
    : "";
  return `{% booking_status status="${status}"${custodianAttr} /%}`;
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

/**
 * Formats custodian information for booking notes with proper links or bold text
 *
 * @param custodian - Custodian object with team member and optional user info
 * @returns Formatted string for use in booking notes
 *
 * If custodian has a user: "{% link to="/settings/team/users/123" text="John Doe" /%}"
 * If custodian is team member only: "**Team Member Name**"
 */
export function wrapCustodianForNote(custodian: {
  teamMember: {
    name: string;
    user?: {
      id: string;
      firstName?: string | null;
      lastName?: string | null;
    } | null;
  };
}): string {
  const { teamMember } = custodian;

  if (teamMember.user) {
    // Custodian has a user account, create a link
    return wrapUserLinkForNote({
      id: teamMember.user.id,
      firstName: teamMember.user.firstName,
      lastName: teamMember.user.lastName,
    });
  } else {
    // Team member without user account, use bold text with escaped asterisks
    return `**${teamMember.name.replace(/\*\*/g, "\\*\\*")}**`;
  }
}

/**
 * Wraps description text in Markdoc description tag syntax for truncation and popover display
 *
 * @param oldText - The previous description text (optional)
 * @param newText - The new description text (optional)
 * @returns String with description wrapped in Markdoc tag syntax
 *
 * Examples:
 * - Single description: wrapDescriptionForNote(undefined, "New description")
 *   -> "{% description newText=\"New description\" /%}"
 * - Description change: wrapDescriptionForNote("Old description", "New description")
 *   -> "{% description oldText=\"Old description\" newText=\"New description\" /%}"
 */
export function wrapDescriptionForNote(
  oldText?: string | null,
  newText?: string | null
): string {
  const oldAttr = oldText
    ? ` oldText="${oldText.replace(/"/g, "&quot;")}"`
    : "";
  const newAttr = newText
    ? ` newText="${newText.replace(/"/g, "&quot;")}"`
    : "";

  return `{% description${oldAttr}${newAttr} /%}`;
}
