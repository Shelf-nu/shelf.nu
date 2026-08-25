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
import { resolveCompanionServer } from "~/modules/api/companion-servers.server";
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
    return data({ baseUrl: null });
  }

  return data({ baseUrl: resolveCompanionServer(parsed.data.domain) });
}
