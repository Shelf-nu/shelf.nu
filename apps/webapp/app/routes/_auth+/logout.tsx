/**
 * Logout route.
 *
 * The action ends the Supabase session that owns the cookie's refresh token,
 * clears the session cookie and the list preference cookies, then redirects
 * to a same-origin path from the form (the login page by default). Ending the
 * server-side session is best-effort: signing out always succeeds for the
 * person in front of the browser.
 *
 * @see {@link file://./../../modules/auth/service.server.ts} endSessionByRefreshToken
 */
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { z } from "zod";

import { endSessionByRefreshToken } from "~/modules/auth/service.server";
import { expireListPreferenceCookies } from "~/utils/cookies.server";
import { assertIsPost, parseData, safeRedirect } from "~/utils/http.server";

/**
 * Signs the current browser out.
 *
 * @returns A redirect to `redirectTo` when it stays on this app, else `/login`
 */
export async function action({ context, request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { redirectTo } = parseData(
    await request.formData(),
    z.object({
      redirectTo: z.string().optional(),
    })
  );

  // The refresh token in the cookie stays valid on the server until its
  // session is ended, so clearing the cookie alone does not sign it out.
  if (context.isAuthenticated) {
    const { refreshToken } = context.getSession();
    await endSessionByRefreshToken(refreshToken);
  }

  context.destroySession();
  // The next person on this browser starts with clean lists. The target comes
  // from the form, so only same-origin paths are followed.
  return redirect(safeRedirect(redirectTo, "/login"), {
    headers: await expireListPreferenceCookies(request, { event: "sign-out" }),
  });
}

/** Logout has no page; a GET goes home. */
export function loader() {
  return redirect("/");
}
