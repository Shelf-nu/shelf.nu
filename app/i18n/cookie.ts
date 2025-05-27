import { parse } from "cookie";
import i18n from "./i18n"; // your i18n configuration file
export function getLng(request: { headers: { get: (arg0: string) => any } }) {
  const cookies = request.headers.get("cookie");
  if (!cookies) return i18n.fallbackLng;

  const parsedCookies = parse(cookies);
  return parsedCookies.i18next || i18n.fallbackLng;
}
