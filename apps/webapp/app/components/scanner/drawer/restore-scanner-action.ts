/**
 * Which action the bulk scanner returns to when it puts a parked list back.
 *
 * The scanner page opens on "View asset", which shows no list, so the action
 * a list was parked under is remembered with its draft. Returning to it is
 * only right while the signed-in user may still use it: a role can change
 * between visits, and a remembered value is only as trustworthy as the
 * storage it came from.
 *
 * @see {@link file://./../../../routes/_layout+/scanner.tsx}
 */
import type { ActionType } from "./action-switcher";

/** The one scanner action that opens each scan instead of collecting a list. */
export const VIEW_ASSET_ACTION: ActionType = "View asset";

/**
 * Decides the action to switch to for a restored list.
 *
 * @param parkedAction - The context saved with the draft, or `null`
 * @param availableActions - The actions the user's role may use now
 * @returns The action to switch to, or `null` to stay where the page is: the
 *   parked action is unknown, no longer allowed, or the one that shows no list
 */
export function scannerActionToRestore(
  parkedAction: string | null,
  availableActions: readonly ActionType[]
): ActionType | null {
  const allowed = availableActions.find(
    (available) => available === parkedAction
  );
  if (!allowed || allowed === VIEW_ASSET_ACTION) {
    return null;
  }
  return allowed;
}
