/**
 * Shared by the web and mobile SSO callback pages.
 *
 * @see {@link file://./../routes/_auth+/oauth.callback.tsx}
 * @see {@link file://./../routes/_auth+/oauth.callback_.mobile.tsx}
 */

/** What the callback pages show when the identity provider refused a sign-in. */
export const SSO_PROVIDER_ERROR_MESSAGE =
  "Sign-in failed at your identity provider. Please try again.";

/**
 * The message to show when Supabase sent the browser back with a failed
 * sign-in (`?error=` or `?error_description=` on the callback URL).
 *
 * Always the fixed message, never the URL's own text: anyone can link to the
 * callback with any description, and the page must not repeat it as if Shelf
 * had said it.
 *
 * @param searchParams - The callback URL's query
 * @returns The message, or null when the URL reports no error
 */
export function readProviderError(searchParams: URLSearchParams) {
  return searchParams.has("error") || searchParams.has("error_description")
    ? SSO_PROVIDER_ERROR_MESSAGE
    : null;
}
