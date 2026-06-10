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
import { getActionMethod } from "~/utils/http.server";

const ExchangeSchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
});

/**
 * POST /api/mobile/exchange
 *
 * Body: `{ code: string }` — the single-use code from the SSO deeplink.
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

    const authSession = await redeemMobileAuthCode(parsed.data.code);

    // Opportunistic cleanup of expired codes (no app-level cron in this repo).
    // Fire-and-forget: a cleanup failure must never affect the exchange.
    void deleteExpiredMobileAuthCodes().catch(() => undefined);

    return data({
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken,
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
