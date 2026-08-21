/**
 * Companion-app server resolution (Shelf Cloud only).
 *
 * The companion app posts the domain of the email the user typed at login and
 * gets back the base URL of the Shelf instance that domain belongs to, so it
 * can point itself at the right server before authenticating. Deliberately NOT
 * behind `requireMobileAuth` — the caller has no session yet, and resolving
 * *where* to authenticate is the whole point.
 *
 * Returns exactly one answer for exactly one domain and never enumerates the
 * registry, so the endpoint can't be used to dump the customer list. It
 * inherits the per-IP rate limit applied to `/api/mobile/*` in
 * `server/index.ts`, which caps domain probing.
 *
 * Fail-open by design: any bad input resolves to `{ baseUrl: null }` ("use
 * Shelf Cloud") rather than an error status, so a malformed request can never
 * block sign-in.
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
