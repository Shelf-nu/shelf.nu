/**
 * Companion-app server resolution (Shelf Cloud only).
 *
 * The companion app posts a domain the user deliberately entered — its
 * "Connect to a private server" flow — and gets back the base URL of the Shelf
 * instance that domain belongs to. Deliberately NOT behind `requireMobileAuth`:
 * the caller has no session yet, and resolving *where* to authenticate is the
 * whole point.
 *
 * Always answered by Shelf Cloud, even for an app already connected elsewhere,
 * because Cloud owns the registry.
 *
 * Returns exactly one answer for exactly one domain and never enumerates the
 * registry, so the endpoint can't be used to dump the customer list. It
 * inherits the per-IP rate limit applied to `/api/mobile/*` in
 * `server/index.ts`, which caps domain probing.
 *
 * The answer carries the base URL and, alongside it, whether the app should
 * hide password sign-in for that server. Nothing secret belongs in this
 * payload: it is unauthenticated, so treat every field added here as public.
 *
 * Bad input resolves to `{ baseUrl: null }` rather than an error status. That
 * is the same answer an unregistered domain gets, and the app treats it as
 * "this domain has no private server" — it reports that to the user and does
 * NOT switch. Returning null is therefore not a fallback to Shelf Cloud; it is
 * a refusal the caller surfaces.
 *
 * @see {@link file://./../../../modules/api/companion-servers.server.ts}
 * @see {@link file://./config.ts} — what the app fetches once it knows the URL
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  isPasswordLoginDisabledFor,
  resolveCompanionServer,
} from "~/modules/api/companion-servers.server";
import { getActionMethod } from "~/utils/http.server";

/** 253 is the maximum length of a fully-qualified domain name (RFC 1035). */
const ResolveServerSchema = z.object({
  domain: z.string().min(1).max(253),
});

/**
 * POST /api/mobile/resolve-server
 *
 * Body: `{ domain: string }`.
 *
 * @param args - React Router action args carrying the incoming request.
 * @returns `{ baseUrl: string | null }`, where `null` means "use Shelf Cloud";
 *   405 when the method is not POST.
 */
export async function action({ request }: ActionFunctionArgs) {
  if (getActionMethod(request) !== "POST") {
    return data({ error: { message: "Method not allowed" } }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  const parsed = ResolveServerSchema.safeParse(body);
  if (!parsed.success) {
    // Not "use Shelf Cloud": the app reports an unrecognised domain and does
    // NOT switch. Same answer an unregistered domain gets, deliberately — a
    // malformed request must not be able to tell the two apart.
    return data({ baseUrl: null, disablePasswordLogin: false });
  }

  const { domain } = parsed.data;

  return data({
    baseUrl: resolveCompanionServer(domain),
    // Per-server presentation for the companion app, set centrally by Shelf.
    // Not a security control: it hides the app's password fields, and the app
    // authenticates against the target's Supabase directly, so nothing here
    // could refuse a sign-in. The web login form is unaffected.
    disablePasswordLogin: isPasswordLoginDisabledFor(domain),
  });
}
