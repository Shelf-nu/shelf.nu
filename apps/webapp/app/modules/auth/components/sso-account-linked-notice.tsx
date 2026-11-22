/**
 * Success notice for an SSO callback whose sign-in moved an existing account
 * onto single sign-on. The session from that sign-in belonged to a merged
 * duplicate and is not issued; the next SSO sign-in lands on the account. It
 * reads as a success with one clear next step, never as an error.
 *
 * @see {@link file://./../../../routes/_auth+/oauth.callback.tsx}
 * @see {@link file://./../../../routes/_auth+/oauth.callback_.mobile.tsx}
 */
import { Button } from "~/components/shared/button";

/** Where the notice is shown, which decides how the user signs in again. */
type SsoAccountLinkedNoticeVariant = "web" | "mobile";

/**
 * Renders the "account is now on single sign-on, sign in again" notice.
 *
 * @param props.variant - `web` links straight to SSO login; `mobile` runs in
 *   the system browser the app opened, so it tells the user to return to the
 *   app and sign in with SSO there
 */
export function SsoAccountLinkedNotice({
  variant,
}: {
  variant: SsoAccountLinkedNoticeVariant;
}) {
  return (
    <div
      role="status"
      className="w-full max-w-md rounded-lg border border-success-200 bg-success-25 p-5 text-left"
    >
      <p className="text-base font-semibold text-success-700">
        Your account is now on single sign-on
      </p>
      <p className="mt-1 text-sm text-gray-700">
        {variant === "web"
          ? "One more step: sign in with SSO again to open your account. Your data and workspaces are all there."
          : "One more step: close this window and sign in with SSO again in the Shelf app. Your data and workspaces are all there."}
      </p>
      {variant === "web" ? (
        <Button to="/sso-login" className="mt-4" width="full">
          Sign in with SSO
        </Button>
      ) : null}
    </div>
  );
}
