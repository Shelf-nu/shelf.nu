import { createCookie } from "@remix-run/node"; // or cloudflare/deno

export const userPrefs = createCookie("user-prefs", {
  maxAge: 604_800, // one week
});

export async function updateCookieWithPerPage(
  request: Request,
  perPageParam: number
) {
  /* Get the cookie header */
  const cookieHeader = request.headers.get("Cookie");

  let cookie = (await userPrefs.parse(cookieHeader)) || {};

  /** If the perPageParam is different from the cookie, we update the cookie */
  if (cookie && perPageParam !== cookie.perPage && perPageParam !== 0) {
    cookie.perPage = perPageParam;
  }
  return cookie;
}
