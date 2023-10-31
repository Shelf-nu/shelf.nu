import type { Cookie } from "@remix-run/node";

// find cookie by name from request headers
export function getCookie(name: string, headers: Headers) {
  const cookie = headers.get("cookie");
  if (!cookie) return null;

  const match = cookie.match(new RegExp(`(^| )${name}=([^;]+)`));
  if (match) return match[2];
}

/**
 * Parse a cookie from a request
 *
 */
export async function parseCookie<T>(
  cookie: Cookie,
  request: Request
): Promise<T | null> {
  const cookieHeader = request.headers.get("Cookie");
  const result = await cookie.parse(cookieHeader).catch(() => null);

  if (!result) {
    return null;
  }

  return result;
}

/**
 * Serialize a cookie for a response
 *
 */
export async function serializeCookie<T>(cookie: Cookie, value: T | null) {
  return cookie.serialize(value).catch(() => "");
}

/**
 * Serialize a cookie for deletion
 *
 */
export async function destroyCookie(cookie: Cookie) {
  return cookie.serialize("", { maxAge: 0 }).catch(() => "");
}

export function setCookie(cookieValue: string): [string, string] {
  return ["Set-Cookie", cookieValue];
}
