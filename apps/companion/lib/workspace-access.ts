/**
 * Workspace access in the companion: which workspaces the mobile API refuses
 * ("inactive"), where the app lands, and how a refusal is recognised.
 *
 * The server decides. `/api/mobile/me` marks each workspace with `inactive`,
 * `inactiveReason` and `inactiveMessage` (a lapsed Team plan, or switched off
 * by a Shelf admin), and every other mobile route answers a request in an
 * inactive workspace with a 403. These helpers only read those answers, so a
 * server without the fields reads every workspace as active, which is what
 * such a server does.
 *
 * MIRROR of `MOBILE_WORKSPACE_INACTIVE_REASON` in
 * apps/webapp/app/modules/api/mobile-auth.server.ts: the reason string and the
 * fallback message (used only when the server sends none) are copies, for
 * display only; the server refuses inactive workspaces on its own. Extraction
 * target: a pure `packages/*` mobile-contract module (none yet).
 *
 * @see apps/webapp/app/modules/api/mobile-auth.server.ts `getMobileWorkspaceStates`
 * @see components/inactive-workspace-screen.tsx
 */
import type { ApiErrorDetails } from "./api/error-details";
import type { Organization } from "./api/types";

/**
 * The `reason` a scan lookup sends when the code's workspace is inactive.
 * Mirrors `MOBILE_WORKSPACE_INACTIVE_REASON` on the server.
 */
export const WORKSPACE_INACTIVE_REASON = "workspace_inactive";

/** Shown when the server sends no message of its own. */
const FALLBACK_INACTIVE_MESSAGE =
  "This workspace is inactive. Contact the workspace owner for more information.";

/**
 * Whether the mobile API refuses requests in this workspace.
 *
 * @param org - A workspace from `/api/mobile/me`, or none.
 * @returns `true` only when the server marked it inactive.
 */
export function isWorkspaceInactive(
  org: Pick<Organization, "inactive"> | null | undefined
): boolean {
  return org?.inactive === true;
}

/**
 * The text that says why a workspace is inactive.
 *
 * @param org - An inactive workspace.
 * @returns The server's message, or a plain fallback without one.
 */
export function inactiveWorkspaceMessage(
  org: Pick<Organization, "inactiveMessage">
): string {
  return org.inactiveMessage || FALLBACK_INACTIVE_MESSAGE;
}

/**
 * Picks the workspace the app opens.
 *
 * The preferred ids are tried in order (this device's own choice, then the
 * server's), then the server's landing order. An inactive workspace is passed
 * over while an active one exists: opening the app onto a workspace that
 * refuses every request helps nobody. When every workspace is inactive, the
 * first choice still opens, and shows why it is inactive.
 *
 * @param orgs - The workspaces from `/api/mobile/me`, in the server's order.
 * @param preferredIds - Ids to try first, in order; `null` entries are skipped.
 * @returns The workspace to open, or `null` when there is none.
 */
export function pickLandingOrg(
  orgs: readonly Organization[],
  preferredIds: readonly (string | null | undefined)[]
): Organization | null {
  const preferred = preferredIds
    .map((id) => (id ? orgs.find((org) => org.id === id) : undefined))
    .filter((org): org is Organization => org !== undefined);
  const candidates = [...preferred, ...orgs];
  return (
    candidates.find((org) => !isWorkspaceInactive(org)) ?? candidates[0] ?? null
  );
}

/**
 * Whether two copies of a workspace from `/api/mobile/me` hold the same
 * values. Fields are flat values or arrays of them (`roles`).
 */
function sameWorkspace(a: Organization, b: Organization): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const x = (a as Record<string, unknown>)[key];
    const y = (b as Record<string, unknown>)[key];
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length || x.some((item, i) => item !== y[i])) {
        return false;
      }
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

/**
 * The workspace to keep open after `/me` is read again.
 *
 * The open workspace stays open, so a workspace that becomes inactive shows
 * why rather than switching under the person. It takes the fresh copy
 * whenever anything about it changed (active state, roles, add-ons,
 * switches), and keeps the same object when nothing did, so screens keyed on
 * the object do not reload for nothing.
 *
 * @param live - The workspace open now.
 * @param orgs - The workspaces just read.
 * @returns The workspace to keep, or `null` when it is gone from the list.
 */
export function refreshOpenOrg(
  live: Organization,
  orgs: readonly Organization[]
): Organization | null {
  const fresh = orgs.find((org) => org.id === live.id);
  if (!fresh) return null;
  return sameWorkspace(fresh, live) ? live : fresh;
}

/**
 * The switcher's label for a workspace.
 *
 * @param org - The workspace.
 * @param currentOrgId - The workspace open now.
 * @returns Its name, marked "(inactive)" and "(current)" where they apply.
 */
export function workspaceSwitchLabel(
  org: Organization,
  currentOrgId: string | null | undefined
): string {
  const marks = [
    isWorkspaceInactive(org) ? "inactive" : null,
    org.id === currentOrgId ? "current" : null,
  ].filter(Boolean);
  return marks.length > 0 ? `${org.name} (${marks.join(", ")})` : org.name;
}

/**
 * Whether a failed request was refused because a workspace is inactive.
 * Only the scan lookups send this reason; other routes send the message alone.
 *
 * @param details - The failed request's `errorDetails`.
 * @returns `true` for an inactive-workspace refusal.
 */
export function isWorkspaceInactiveRefusal(
  details: Pick<ApiErrorDetails, "reason"> | null | undefined
): boolean {
  return details?.reason === WORKSPACE_INACTIVE_REASON;
}

/**
 * Tabs that stay open in an inactive workspace. Settings holds the workspace
 * switcher, preferences and sign-out, none of which needs the workspace.
 */
const TABS_OPEN_WHEN_INACTIVE: ReadonlySet<string> = new Set(["settings"]);

/**
 * Whether a tab shows the inactive-workspace screen in place of its own.
 *
 * @param routeName - The tab's route name.
 * @param org - The workspace open now.
 * @returns `true` for every tab but Settings while the workspace is inactive.
 */
export function tabShowsInactiveScreen(
  routeName: string,
  org: Pick<Organization, "inactive"> | null | undefined
): boolean {
  return isWorkspaceInactive(org) && !TABS_OPEN_WHEN_INACTIVE.has(routeName);
}

/**
 * The team workspaces worth offering as a place to switch to: an inactive
 * one refuses every request.
 *
 * @param orgs - The workspaces from `/api/mobile/me`.
 * @returns The active team workspaces, in the same order.
 */
export function activeTeamWorkspaces(
  orgs: readonly Organization[]
): Organization[] {
  return orgs.filter((org) => org.type === "TEAM" && !isWorkspaceInactive(org));
}

/**
 * What the scanner shows for a code whose workspace is inactive.
 *
 * @param message - The server's refusal text, when it sent one.
 * @returns The result card's title and message, and the screen-reader line
 *   (title and reason together).
 */
export function workspaceInactiveScanResult(
  message: string | null | undefined
): {
  title: string;
  message: string;
  announcement: string;
} {
  const text = message || "The workspace this code belongs to is inactive.";
  return {
    title: "Workspace Inactive",
    message: text,
    // The reason is read out too: in batch scanning the next scan can replace
    // the card before a screen reader reaches it.
    announcement: `Workspace inactive. ${text}`,
  };
}
