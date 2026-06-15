/**
 * Mobile SSO token exchange.
 *
 * Back-channel of the native-app SSO login: the companion app posts the
 * single-use authorization code it received via the `shelf://auth-callback`
 * deeplink and receives a fresh, independent Supabase session in the JSON body
 * (tokens never travel in a URL). Deliberately NOT behind `requireMobileAuth` —
 * the caller has no session yet; the single-use code IS the credential.
 *
 * @see apps/webapp/app/modules/auth/mobile-sso.server.ts — redeem + mint
 * @see apps/webapp/app/routes/_auth+/oauth.callback.mobile.tsx — issues the code
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  deleteExpiredMobileAuthCodes,
  redeemMobileAuthCode,
} from "~/modules/auth/mobile-sso.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { getActionMethod, logException } from "~/utils/http.server";

const ExchangeSchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  // PKCE verifier (RFC 7636: 43–128 chars, base64url unreserved charset).
  // Optional — only codes minted by a PKCE-capable app build carry a challenge
  // that requires it. The charset is constrained to mirror the strict S256
  // `code_challenge` validation at `/sso-login`; a non-conforming verifier could
  // never hash to a stored challenge anyway, so we reject it up front.
  codeVerifier: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43,128}$/)
    .optional(),
});

/**
 * POST /api/mobile/exchange
 *
 * Body: `{ code: string, codeVerifier?: string }` — the single-use code from
 * the SSO deeplink, plus the PKCE verifier when the app build supports it.
 *
 * @param args - React Router action args (carrying the incoming request)
 * @returns `{ accessToken, refreshToken }` on success (the app passes them to
 *   `supabase.auth.setSession`), or `{ error: { message } }` with a 4xx status.
 *   A non-existent / expired / already-used code yields a uniform 400.
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const method = getActionMethod(request);
    if (method !== "POST") {
      throw notAllowedMethod(method);
    }

    const body = await request.json().catch(() => null);
    const parsed = ExchangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ShelfError({
        cause: null,
        message: "Authorization code is required",
        label: "Auth",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const authSession = await redeemMobileAuthCode(
      parsed.data.code,
      parsed.data.codeVerifier
    );

    // Opportunistic cleanup of expired codes (no app-level cron in this repo).
    // Fire-and-forget: a cleanup failure must never affect the exchange.
    void deleteExpiredMobileAuthCodes().catch(() => undefined);

    return data({
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    // why: this resource route returns failures as JSON (the companion app
    // parses `{ error }`) and never re-throws, so without an explicit log a
    // genuine 5xx (Supabase mint outage, broken auth contract, DB fault) would
    // never reach Sentry. `logException` mirrors `error()`'s logging (5xx →
    // Sentry, handled 4xx → low-severity trail, client aborts skipped). NOTE:
    // every route under `api+/mobile+/` swallows 5xx this same way and none log
    // yet — `logException` is the shared fix to finish that off route by route.
    logException(reason);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
