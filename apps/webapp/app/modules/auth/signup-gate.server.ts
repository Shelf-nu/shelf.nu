/**
 * Signup gate.
 *
 * When `DISABLE_SIGNUP` is set (`config.disableSignup`), nobody may create a
 * Shelf account by signing up on their own: the `/join` page and its action
 * refuse, and a verified email code for an auth user with no Shelf account
 * does not create one. Invite acceptance and SSO create accounts through their
 * own services and are not gated here.
 *
 * @see {@link file://./../../routes/_auth+/join.tsx}
 * @see {@link file://./../../routes/_auth+/otp.tsx}
 */
import { config } from "~/config/shelf.config";
import { ShelfError } from "~/utils/error";

/**
 * Refuse with 403 when self-service signup is disabled.
 *
 * Reads the config on every call, so it reflects the running configuration.
 *
 * @throws {ShelfError} 403 when `config.disableSignup` is set
 */
export function assertSignupEnabled(): void {
  if (!config.disableSignup) {
    return;
  }

  throw new ShelfError({
    cause: null,
    title: "Signup is disabled",
    message:
      "For more information, please contact your workspace administrator.",
    label: "User onboarding",
    status: 403,
    shouldBeCaptured: false,
  });
}
