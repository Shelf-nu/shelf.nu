/**
 * Email Login Switch
 *
 * The one place that refuses a sign-in with an email address while the
 * deployment has switched email login off (`DISABLE_EMAIL_LOGIN`, see
 * `config.disableEmailLogin`). "Email login" is every way in that needs only
 * an address: password, one-time code, password reset, and signing up with
 * either.
 *
 * The switch is the same for every address, so refusing here tells a caller
 * nothing about any account. That is why these refusals may be explicit, while
 * the per-account SSO decision (`sso-enforcement.server.ts`) must stay silent
 * before authentication.
 *
 * Every entry point asks {@link assertEmailLoginEnabled}:
 * - the login, signup and password reset actions, before anything is read or
 *   sent;
 * - `sendOTP` and `verifyOtpAndSignin`, which covers every route that sends or
 *   redeems a code, including a code sent before the switch was turned on;
 * - the mobile API guard, for a session the companion app opened directly
 *   against Supabase.
 *
 * @see {@link file://./../../config/types.ts} disableEmailLogin
 * @see {@link file://./service.server.ts} sendOTP, verifyOtpAndSignin
 * @see {@link file://./../api/mobile-auth.server.ts} requireMobileAuth
 */
import { config } from "~/config/shelf.config";
import { ShelfError } from "~/utils/error";

/**
 * Builds the error shown when a sign-in with an email address is refused
 * because the deployment only allows single sign-on.
 *
 * @returns a 403 `ShelfError`, not captured: a refusal is expected, not a fault
 */
export function createEmailLoginDisabledError(): ShelfError {
  return new ShelfError({
    cause: null,
    status: 403,
    title: "Email login is disabled",
    message:
      "Signing in with an email address is disabled. Please use single sign-on.",
    label: "Auth",
    shouldBeCaptured: false,
  });
}

/**
 * Refuses the current operation while email login is switched off.
 *
 * @throws {ShelfError} 403 when `config.disableEmailLogin` is set
 */
export function assertEmailLoginEnabled(): void {
  if (config.disableEmailLogin) {
    throw createEmailLoginDisabledError();
  }
}
