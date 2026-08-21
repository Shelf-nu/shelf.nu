/**
 * Native-app SSO login (web-delegated auth).
 *
 * SSO organizations disable password authentication, so the password-only login
 * screen can't sign these users in. This opens the system browser to the web
 * SSO flow (`/sso-login?platform=mobile`); after the user authenticates there,
 * the web hands back a single-use authorization code via the
 * `shelf://auth-callback` deeplink. We exchange that code at
 * `POST /api/mobile/exchange` for a fresh, independent Supabase session and
 * install it with `supabase.auth.setSession`.
 *
 * No tokens ever appear in a URL — only the short-lived, single-use code.
 *
 * @see apps/webapp/app/routes/_auth+/oauth.callback.mobile.tsx
 * @see apps/webapp/app/routes/api+/mobile+/exchange.ts
 */
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL } from "./api";
import { supabase } from "./supabase";

/** Deeplink the web SSO callback redirects to once it has a code for the app. */
const AUTH_CALLBACK_URL = "shelf://auth-callback";

/** Result of an SSO sign-in attempt. `error` is null on success or on a plain
 *  user cancellation (nothing to surface). */
export type SsoSignInResult = { error: string | null };

/** Shape of the `/api/mobile/exchange` JSON response. */
type ExchangeResponse = {
  accessToken?: string;
  refreshToken?: string;
  error?: { message?: string };
};

/** Base64url alphabet (RFC 4648 §5) — URL-safe, no padding. */
const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Encode raw bytes as base64url (no padding). 32 bytes → 43 chars, all within
 * the server's strict `^[A-Za-z0-9_-]{43,128}$` verifier charset.
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += BASE64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Convert standard base64 to base64url (no padding). */
function base64ToBase64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Generate a PKCE (RFC 7636, S256) verifier + challenge pair.
 *
 * `verifier` = base64url of 32 random bytes (43 chars). `challenge` =
 * base64url(SHA-256(verifier)) — what the server binds to the minted code and
 * later recomputes from the verifier we send at exchange. The base64url
 * encoding must match the server byte-for-byte (it validates a 43-char base64url
 * challenge), so we convert Expo's base64 digest to base64url here.
 */
async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = bytesToBase64Url(await Crypto.getRandomBytesAsync(32));
  const digestBase64 = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return { verifier, challenge: base64ToBase64Url(digestBase64) };
}

/**
 * Runs the full web-delegated SSO sign-in and installs the resulting session.
 *
 * Opens the web SSO page in the system browser, waits for the `shelf://`
 * callback, exchanges the returned single-use code for a fresh session, and
 * calls `supabase.auth.setSession` (which fires `onAuthStateChange`, so the
 * existing auth context navigates the user into the app).
 *
 * Never throws — failures are returned as `{ error }` for the caller to display.
 *
 * @returns `{ error: null }` on success or user cancellation, otherwise
 *   `{ error: <message> }`.
 */
export async function signInViaWeb(): Promise<SsoSignInResult> {
  try {
    // PKCE (S256): generate a verifier now and send only its challenge to the
    // web SSO start, so the server binds the challenge to the minted code. The
    // verifier never leaves the app and is presented at exchange — an
    // intercepted `shelf://` code is useless without it (this closes the Android
    // custom-scheme deeplink interception risk).
    const { verifier, challenge } = await createPkcePair();
    const startUrl = `${API_BASE_URL}/sso-login?platform=mobile&code_challenge=${encodeURIComponent(
      challenge
    )}`;

    const result = await WebBrowser.openAuthSessionAsync(
      startUrl,
      AUTH_CALLBACK_URL
    );

    // User dismissed/cancelled the browser — not an error worth surfacing.
    if (result.type !== "success") {
      return { error: null };
    }

    const { queryParams } = Linking.parse(result.url);
    const code =
      typeof queryParams?.code === "string" ? queryParams.code : null;
    if (!code) {
      return { error: "Sign-in failed: no authorization code was returned." };
    }

    // Back-channel exchange — the code travels in the HTTPS body, never a URL.
    // Abort after 15s so a flaky network can't leave sign-in hanging forever.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}/api/mobile/exchange`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, codeVerifier: verifier }),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) {
        return { error: "Sign-in timed out. Please try again." };
      }
      throw cause;
    } finally {
      clearTimeout(timeout);
    }

    const payload = (await response
      .json()
      .catch(() => null)) as ExchangeResponse | null;

    if (!response.ok || !payload?.accessToken || !payload?.refreshToken) {
      return {
        error: payload?.error?.message ?? "Sign-in failed. Please try again.",
      };
    }

    const { error } = await supabase.auth.setSession({
      access_token: payload.accessToken,
      refresh_token: payload.refreshToken,
    });
    if (error) {
      return { error: error.message };
    }

    return { error: null };
  } catch (cause) {
    return {
      error:
        cause instanceof Error
          ? cause.message
          : "Something went wrong during sign-in.",
    };
  }
}
