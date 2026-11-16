/**
 * Which action the bulk scanner returns to when it puts a parked list back.
 *
 * The scanner page opens on "View asset", which shows no list, so the action
 * a list was parked under is remembered with its draft. Returning to it is
 * only right while the signed-in user may still use it: a role can change
 * between visits, and a remembered value is only as trustworthy as the
 * storage it came from. A restored list is never left out of sight.
 *
 * @see {@link file://./../../../routes/_layout+/scanner.tsx}
 */
import type { ActionType } from "./action-switcher";

/** The one scanner action that opens each scan instead of collecting a list. */
export const VIEW_ASSET_ACTION: ActionType = "View asset";

/**
 * Decides the action to switch to for a restored list.
 *
 * The parked action wins while the role still allows it. Otherwise the list
 * still has to be shown, or it would sit hidden under "View asset" and look
 * lost, so the first allowed action that shows a list is used instead.
 *
 * @param parkedAction - The context saved with the draft, or `null`
 * @param availableActions - The actions the user's role may use now, in menu
 *   order
 * @returns The action to switch to, or `null` when the role allows no action
 *   that shows a list
 */
export function scannerActionToRestore(
  parkedAction: string | null,
  availableActions: readonly ActionType[]
): ActionType | null {
  const listActions = availableActions.filter(
    (action) => action !== VIEW_ASSET_ACTION
  );
  return (
    listActions.find((action) => action === parkedAction) ??
    listActions[0] ??
    null
  );
}
