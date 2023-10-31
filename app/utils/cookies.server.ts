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
  /** If the cookie doesn't have perPage, adding perPage attribute and setting it to its default value 20*/
  if (!cookie.perPage) {
    cookie.perPage = 20;
  }
  /** If the perPageParam is different from the cookie, we update the cookie */
  if (cookie && perPageParam !== cookie.perPage && perPageParam !== 0) {
    cookie.perPage = perPageParam;
  }
  return cookie;
}

/**
 * Used to set the perPage cookie on the first load of the page if it doesn't exist
 *
 */
export async function initializePerPageCookieOnLayout(request: Request) {
  const cookieHeader = request.headers.get("Cookie");
  const cookie = (await userPrefs.parse(cookieHeader)) || {};
  cookie.perPage = 20;
  return cookie;
}
