import { parse } from "cookie";

export function getLng(request: { headers: { get: (arg0: string) => any } }) {
  const cookies = request.headers.get("cookie");
  if (!cookies) return null;

  const parsedCookies = parse(cookies);
  return parsedCookies.i18next || null;
}
