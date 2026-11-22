/**
 * Client-safe copy for the SSO purchase restriction.
 *
 * Kept free of server imports so the subscription page can render the same
 * sentence the server raises in its 403.
 *
 * @see {@link file://./sso-purchase-gate.server.ts}
 */

/** Shown to SSO users who may not start a purchase, and used as the 403 message. */
export const PURCHASES_UNAVAILABLE_MESSAGE =
  "Billing for single sign-on accounts is managed by your workspace owner.";
