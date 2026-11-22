/**
 * SSO sign-in with PKCE (RFC 7636) between Shelf and Supabase Auth.
 *
 * A sign-in that starts at `/sso-login` (SAML SSO, {@link startSsoSignIn}) or
 * `/oidc-login` (the custom OIDC login, {@link startOidcSignIn}) asks Supabase
 * for an authorization code instead of tokens. The secret half of the pair, the code verifier,
 * stays in this browser's `sso_code_verifier` cookie; only its hash travels to
 * Supabase. The callback then trades `?code=` for a session, which Supabase
 * grants only with the matching verifier. A callback link opened in any other
 * browser therefore cannot complete, so no one can sign another person's
 * browser into their own account by sending them a link.
 *
 * Sign-ins started from the identity provider's dashboard (an Okta tile, say)
 * never pass through either route, so they carry no verifier and arrive with
 * tokens in the URL fragment instead. The web callback handles those
 * separately, behind an explicit confirmation step.
 *
 * Supabase's client library keeps the verifier in its storage under
 * `<storageKey>-code-verifier`, JSON-encoded. Each call here builds a
 * throwaway client over an in-memory map, so the verifier can be read out
 * after the start and handed back in for the exchange, and nothing is shared
 * between requests.
 *
 * @see {@link file://./../../routes/_auth+/sso-login.tsx} starts a SAML sign-in
 * @see {@link file://./../../routes/_auth+/oidc-login.tsx} starts an OIDC sign-in
 * @see {@link file://./../../routes/_auth+/oauth.callback.tsx} web exchange
 * @see {@link file://./../../routes/_auth+/oauth.callback_.mobile.tsx} mobile exchange
 */
import type { Provider, SupportedStorage } from "@supabase/supabase-js";
import { createClient, isAuthApiError } from "@supabase/supabase-js";
import type { AuthSession } from "@server/session";
import {
  getSupabaseAdmin,
  visitorIpHeaders,
} from "~/integrations/supabase/client";
import {
  OIDC_PROVIDER,
  OIDC_SCOPES,
  SERVER_URL,
  SUPABASE_ANON_PUBLIC,
  SUPABASE_SECRET_KEY,
  SUPABASE_URL,
} from "~/utils/env";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { mapAuthSession } from "./mappers.server";
import type { VisitorIp } from "./service.server";

const label: ErrorLabel = "Auth";

/** Storage key of the throwaway clients; the verifier sits at `<key>-code-verifier`. */
const STORAGE_KEY = "shelf-sso";
const VERIFIER_ITEM = `${STORAGE_KEY}-code-verifier`;

/**
 * Shape of a PKCE code verifier (RFC 7636 section 4.1): 43 to 128 characters
 * of the unreserved URL set. Anything else read from the cookie is ignored.
 */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Builds a Supabase Auth client in PKCE mode over an in-memory store, seeded
 * with `codeVerifier` when one is given. The library keeps every storage item
 * JSON-encoded, so the store holds the verifier the same way.
 *
 * `persistSession` must stay true: with it off, the library ignores the
 * `storage` option and keeps the verifier where this code cannot reach it.
 * The store lives only as long as this call, so nothing is persisted.
 *
 * Authenticates with `SUPABASE_SECRET_KEY` when set, so the visitor's IP can
 * travel as `Sb-Forwarded-For` (Supabase reads it only with a secret key) and
 * the per-IP token limit counts the visitor, as for every other sign-in.
 * Without a secret key it uses the anon key and sends no IP.
 *
 * @param codeVerifier - The verifier to exchange a code with, if any
 * @param visitor - see `VisitorIp` in `./service.server`
 * @returns The auth client and the store it writes to
 */
function createPkceAuthClient(
  codeVerifier?: string,
  { clientIp }: VisitorIp = {}
) {
  const store = new Map<string, string>();
  if (codeVerifier) store.set(VERIFIER_ITEM, JSON.stringify(codeVerifier));

  const storage: SupportedStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };

  const headers = visitorIpHeaders(clientIp);
  const client = createClient(
    SUPABASE_URL,
    SUPABASE_SECRET_KEY || SUPABASE_ANON_PUBLIC,
    {
      global: { headers },
      auth: {
        flowType: "pkce",
        storage,
        storageKey: STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  /** The verifier the library stored when a sign-in started, if any. */
  function storedVerifier(): unknown {
    const item = store.get(VERIFIER_ITEM);
    if (item === undefined) return undefined;
    try {
      return JSON.parse(item);
    } catch {
      return undefined;
    }
  }

  return { auth: client.auth, storedVerifier };
}

/**
 * Whether a value read from the verifier cookie is a well-formed verifier.
 *
 * @param value - Whatever the cookie held
 * @returns true when it can be presented to Supabase
 */
export function isCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && CODE_VERIFIER_PATTERN.test(value);
}

/**
 * The Shelf callback a sign-in lands on. Built here, never taken from the
 * caller, so it is always an allow-listed, query-free Supabase redirect URL
 * (Supabase treats `?` as a wildcard in its allow-list).
 *
 * @param platform - `"mobile"` for the native-app callback, `"web"` otherwise
 * @returns The absolute callback URL
 */
function callbackUrl(platform: "web" | "mobile"): string {
  return `${SERVER_URL}/oauth/callback${
    platform === "mobile" ? "/mobile" : ""
  }`;
}

/**
 * Starts an SSO sign-in for a company domain and returns the identity
 * provider URL to send the browser to, together with the code verifier the
 * caller must keep in the `sso_code_verifier` cookie for the callback.
 *
 * @param domain - The company domain whose SSO provider to use
 * @param options.platform - `"mobile"` lands on the native-app callback; the
 *   web callback otherwise
 * @param options.clientIp - The visitor's IP, see `VisitorIp` in `./service.server`
 * @returns The provider URL and the code verifier
 * @throws {ShelfError} 400 when the domain has no SSO provider
 *   (not captured), or a captured error when Supabase fails to answer
 */
export async function startSsoSignIn(
  domain: string,
  {
    platform = "web",
    clientIp,
  }: { platform?: "web" | "mobile" } & VisitorIp = {}
): Promise<{ url: string; codeVerifier: string }> {
  try {
    const { auth, storedVerifier } = createPkceAuthClient(undefined, {
      clientIp,
    });
    const { data, error } = await auth.signInWithSSO({
      domain,
      options: { redirectTo: callbackUrl(platform) },
    });

    if (error) throw error;

    const codeVerifier = storedVerifier();
    if (!isCodeVerifier(codeVerifier)) {
      throw new ShelfError({
        cause: null,
        message: "Supabase did not start a PKCE sign-in",
        label,
      });
    }

    return { url: data.url, codeVerifier };
  } catch (cause) {
    const noProvider =
      isAuthApiError(cause) && cause.code === "sso_provider_not_found";

    throw new ShelfError({
      cause,
      message: noProvider
        ? "No SSO provider assigned for your organization's domain"
        : "Something went wrong. Please try again later or contact support.",
      label,
      status: noProvider ? 400 : 500,
      shouldBeCaptured: !noProvider,
      additionalData: { domain },
    });
  }
}

/**
 * Starts a sign-in through the custom OIDC provider (`OIDC_PROVIDER`) and
 * returns the URL to send the browser to, together with the code verifier the
 * caller must keep in the `sso_code_verifier` cookie for the callback.
 *
 * The URL is Supabase's authorize endpoint for the provider, with the S256
 * challenge of the verifier. Building it needs no request to Supabase.
 *
 * @param options.platform - `"mobile"` lands on the native-app callback; the
 *   web callback otherwise
 * @param options.clientIp - Unused while no request is made; accepted so both
 *   start functions are called the same way. See `VisitorIp` in
 *   `./service.server`
 * @returns The provider URL and the code verifier
 * @throws {ShelfError} 404 (not captured) when no provider is configured, or a
 *   captured error when the sign-in cannot be started
 */
export async function startOidcSignIn({
  platform = "web",
  clientIp,
}: { platform?: "web" | "mobile" } & VisitorIp = {}): Promise<{
  url: string;
  codeVerifier: string;
}> {
  if (!OIDC_PROVIDER) {
    throw new ShelfError({
      cause: null,
      status: 404,
      title: "Not found",
      message: "This sign-in method is not available.",
      label,
      shouldBeCaptured: false,
    });
  }

  try {
    const { auth, storedVerifier } = createPkceAuthClient(undefined, {
      clientIp,
    });
    const { data, error } = await auth.signInWithOAuth({
      // Supabase names custom providers `custom:<identifier>`.
      provider: OIDC_PROVIDER as Provider,
      options: {
        redirectTo: callbackUrl(platform),
        // Without scopes, the ones stored on the provider in Supabase apply.
        ...(OIDC_SCOPES ? { scopes: OIDC_SCOPES } : {}),
        skipBrowserRedirect: true,
      },
    });

    if (error) throw error;

    const codeVerifier = storedVerifier();
    if (!data.url || !isCodeVerifier(codeVerifier)) {
      throw new ShelfError({
        cause: null,
        message: "Supabase did not start a PKCE sign-in",
        label,
      });
    }

    return { url: data.url, codeVerifier };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong. Please try again later or contact support.",
      label,
      status: 500,
      additionalData: { provider: OIDC_PROVIDER },
    });
  }
}

/**
 * The refusal for a code that cannot be exchanged: no verifier in this
 * browser, a wrong one, or a code that is expired or already used. One message
 * for every case, which also tells the person what to do.
 */
export function ssoSignInExpiredError(cause: unknown = null): ShelfError {
  return new ShelfError({
    cause,
    title: "Sign-in expired",
    message:
      "This sign-in link has expired or was opened in a different browser. Please start the sign-in again.",
    label,
    status: 400,
    shouldBeCaptured: false,
  });
}

/**
 * Trades the authorization code Supabase put on the callback URL for the SSO
 * session, using the verifier this browser kept when the sign-in started.
 *
 * @param args.code - The `?code=` from the callback URL
 * @param args.codeVerifier - The value of the `sso_code_verifier` cookie
 * @param args.clientIp - The visitor's IP, see `VisitorIp` in `./service.server`
 * @returns The SSO session
 * @throws {ShelfError} 400 (not captured) when there is no verifier or
 *   Supabase refuses the pair; a captured 500 when Supabase fails to answer
 */
export async function exchangeSsoCode({
  code,
  codeVerifier,
  clientIp,
}: {
  code: string;
  codeVerifier: unknown;
} & VisitorIp): Promise<AuthSession> {
  if (!code || !isCodeVerifier(codeVerifier)) {
    throw ssoSignInExpiredError();
  }

  try {
    const { auth } = createPkceAuthClient(codeVerifier, { clientIp });
    const { data, error } = await auth.exchangeCodeForSession(code);

    if (error) throw error;

    return mapAuthSession(data.session);
  } catch (cause) {
    throw toSignInError(cause);
  }
}

/**
 * Maps a failure from Supabase Auth to what the person sees. A 4xx (a wrong
 * verifier, an unknown, used or expired code, an invalid token) means they
 * start again; anything else, including a rate limit, is a service failure.
 *
 * @param cause - What Supabase Auth or the mapper threw
 * @returns The error to throw
 */
function toSignInError(cause: unknown): ShelfError {
  if (
    isAuthApiError(cause) &&
    cause.status >= 400 &&
    cause.status < 500 &&
    cause.status !== 429
  ) {
    return ssoSignInExpiredError(cause);
  }

  return new ShelfError({
    cause,
    message: "Could not complete the sign-in. Please try again.",
    label,
    status: 500,
  });
}

/**
 * Reads who an access token from the callback URL fragment signs in, as
 * Supabase Auth reports it. The fragment is attacker-controllable, so the
 * token's own claims are never trusted: Supabase validates the token and
 * returns the account.
 *
 * Used for sign-ins started from the identity provider's dashboard, which
 * carry tokens instead of a code: the callback names the account and asks the
 * person to confirm before signing them in.
 *
 * @param accessToken - The access token from the URL fragment
 * @returns The auth user's id and email
 * @throws {ShelfError} 400 (not captured) when the token is invalid or
 *   expired; a captured 500 when Supabase fails to answer
 */
export async function readTokenAccount(
  accessToken: string
): Promise<{ userId: string; email: string }> {
  try {
    const { data, error } = await getSupabaseAdmin().auth.getUser(accessToken);
    if (error) throw error;
    if (!data.user.email) throw ssoSignInExpiredError();

    return { userId: data.user.id, email: data.user.email };
  } catch (cause) {
    if (cause instanceof ShelfError) throw cause;
    throw toSignInError(cause);
  }
}
