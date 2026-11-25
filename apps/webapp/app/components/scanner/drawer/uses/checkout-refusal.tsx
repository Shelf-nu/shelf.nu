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
 * @see {@link file://./partial-checkout-drawer.tsx}
 * @see {@link file://../../../../routes/_layout+/bookings.$bookingId.overview.checkout-assets.tsx} the action
 */

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

/**
 * Alert with the last check-out refusal from the server, or nothing.
 * Announced to assistive technology through `role="alert"`.
 */
export function CheckoutRefusal() {
  const message = checkoutRefusalMessage(useActionData());
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
