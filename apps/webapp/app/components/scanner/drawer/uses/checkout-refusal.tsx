/**
 * The server's refusal of a scanner check-out, shown in the drawer footer.
 *
 * The drawer's blockers catch what can be judged before submit. Some refusals
 * only the server can make: a pool whose units would leave from a source that
 * is short for the slice, while another of its sources is healthy, passes the
 * `short-source` blocker and is refused at submit with a 400 naming the
 * source. The action returns that error as data, so it is read here and shown
 * as an alert instead of the submit silently doing nothing.
 *
 * The alert belongs to the list it refused: once the list being submitted
 * changes (the refused pool removed, a quantity changed), it is dismissed
 * until the next submit answers.
 *
 * @see {@link file://./partial-checkout-drawer.tsx}
 * @see {@link file://../../../../routes/_layout+/bookings.$bookingId.overview.checkout-assets.tsx} the action
 */

import { useState } from "react";
import { useActionData } from "react-router";
import { isErrorResponse } from "~/utils/http";

/**
 * The message of an action response that is an error.
 *
 * @param actionData - What the route's action returned, if anything
 * @returns The refusal's message, or `null` for no response or a success
 */
export function checkoutRefusalMessage(actionData: unknown): string | null {
  if (!isErrorResponse(actionData)) return null;
  const message = actionData.error.message;
  return typeof message === "string" && message.trim() ? message : null;
}

/** Props for {@link CheckoutRefusal}. */
type CheckoutRefusalProps = {
  /**
   * A value that changes whenever the list the drawer would submit changes,
   * such as the serialized form payload. A refusal is shown only while it
   * still equals the value at the time the refusal arrived.
   */
  listKey: string;
};

/**
 * Alert with the last check-out refusal from the server, or nothing.
 * Announced to assistive technology through `role="alert"`. Dismissed once
 * `listKey` changes, and shown again only for the next refusal.
 */
export function CheckoutRefusal({ listKey }: CheckoutRefusalProps) {
  const actionData = useActionData();
  // The list the latest answer refused, and whether it has changed since.
  // Adjusted during render (not in an effect) so a stale alert never paints.
  const [seen, setSeen] = useState({ actionData, listKey, dismissed: false });
  if (seen.actionData !== actionData) {
    setSeen({ actionData, listKey, dismissed: false });
  } else if (seen.listKey !== listKey) {
    setSeen({ actionData, listKey, dismissed: true });
  }

  const current =
    seen.actionData === actionData &&
    seen.listKey === listKey &&
    !seen.dismissed;
  const message = current ? checkoutRefusalMessage(actionData) : null;
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mx-3 mt-2 rounded-md border border-error-300 bg-error-50 px-3 py-2 text-sm text-error-700"
    >
      {message}
    </p>
  );
}
