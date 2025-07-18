/**
 * This file contains utilities for using client hints for user preference which
 * are needed by the server, but are only known by the browser.
 */
import { parseISO } from "date-fns";
import { parseAcceptLanguage } from "intl-parse-accept-language";
import { ShelfError } from "./error";
import { useRequestInfo } from "./request-info";

export interface ClientHint {
  timeZone: string;
  locale: string;
  theme: "light" | "dark";
}

export interface LocaleHint {
  timeZone: string;
  locale: string;
}

export const clientHints = {
  timeZone: {
    cookieName: "CH-time-zone",
    getValueCode: `Intl.DateTimeFormat().resolvedOptions().timeZone`,
    fallback: "UTC",
  },
  theme: {
    cookieName: "CH-theme",
    getValueCode: `localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')`,
    fallback: "light",
  },
};

type ClientHintNames = keyof typeof clientHints;

function getCookieValue(cookieString: string, name: ClientHintNames) {
  const hint = clientHints[name];
  if (!hint) {
    throw new ShelfError({
      cause: null,
      message: `Unknown client hint: ${name}`,
      label: "Dev error",
    });
  }
  const value = cookieString
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(hint.cookieName + "="))
    ?.split("=")[1];

  return value ? decodeURIComponent(value) : null;
}

/**
 *
 * @param request {Request} - optional request object (only used on server)
 * @returns an object with the client hints and their values
 */
export function getHints(request?: Request) {
  const cookieString =
    typeof document !== "undefined"
      ? document.cookie
      : typeof request !== "undefined"
      ? request.headers.get("Cookie") ?? ""
      : "";

  return Object.entries(clientHints).reduce(
    (acc, [name, hint]) => {
      const hintName = name as ClientHintNames;
      if ("transform" in hint) {
        // @ts-expect-error - this is fine (PRs welcome though)
        acc[hintName] = hint.transform(
          getCookieValue(cookieString, hintName) ?? hint.fallback
        );
      } else {
        acc[hintName] = getCookieValue(cookieString, hintName) ?? hint.fallback;
      }
      return acc;
    },
    {} as {
      [name in ClientHintNames]: (typeof clientHints)[name] extends {
        transform: (value: any) => infer ReturnValue;
      }
        ? ReturnValue
        : (typeof clientHints)[name]["fallback"];
    }
  );
}

export const getClientHint = (request: Request): ClientHint => ({
  locale: getLocale(request),
  timeZone: getHints(request).timeZone,
  theme: (getHints(request).theme as "light" | "dark") || "light",
});

/**
 * @returns an object with the client hints and their values
 */
export function useHints() {
  const requestInfo = useRequestInfo();
  return requestInfo.hints;
}

/**
 * @returns inline script element that prevents theme flash by applying theme class immediately
 */
export function ThemeScript({ nonce }: { nonce: string }) {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: `
(function() {
  try {
    const theme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {
    // Ignore errors in case localStorage is not available
  }
})();
        `,
      }}
    />
  );
}

/**
 * @returns inline script element that checks for client hints and sets cookies
 * if they are not set then reloads the page if any cookie was set to an
 * inaccurate value.
 */
export function ClientHintCheck({ nonce }: { nonce: string }) {
  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: `
const cookies = document.cookie.split(';').map(c => c.trim()).reduce((acc, cur) => {
	const [key, value] = cur.split('=');
	acc[key] = value;
	return acc;
}, {});
let cookieChanged = false;
const hints = [
${Object.values(clientHints)
  .map((hint) => {
    const cookieName = JSON.stringify(hint.cookieName);
    return `{ name: ${cookieName}, actual: String(${hint.getValueCode}), cookie: cookies[${cookieName}] }`;
  })
  .join(",\n")}
];
for (const hint of hints) {
	if (decodeURIComponent(hint.cookie) !== hint.actual) {
		cookieChanged = true;
		document.cookie = encodeURIComponent(hint.name) + '=' + encodeURIComponent(hint.actual) + ';path=/';
	}
}
// if the cookie changed, reload the page, unless the browser doesn't support
// cookies (in which case we would enter an infinite loop of reloads)
if (cookieChanged && navigator.cookieEnabled) {
	window.location.reload();
}
			`,
      }}
    />
  );
}

/**
 * Uses the request's accept-language header to determine the user's preferred
 * locale and the client hint cookies for the user's timeZone returns a
 * DateTimeFormat object for that locale and timezone.
 *
 * All options can be overridden by passing in an options object. By default,
 * the options are all "numeric" and the timeZone.
 */
export function getDateTimeFormat(
  request: Request,
  options?: Intl.DateTimeFormatOptions
) {
  const locale = getLocale(request);

  const hints: LocaleHint = {
    locale,
    timeZone: getHints(request).timeZone,
  };
  return getDateTimeFormatFromHints(hints, options);
}

export function getDateTimeFormatFromHints(
  hints: LocaleHint,
  options?: Intl.DateTimeFormatOptions
) {
  // change your default options here
  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  };

  options = {
    ...(options?.timeStyle ? {} : defaultOptions),
    ...options,
    timeZone: options?.timeZone ?? hints.timeZone,
  };
  return new Intl.DateTimeFormat(hints.locale, options);
}

/**
 *
 * @param request
 * @returns current locale. Defaults to en-US
 */
export function getLocale(request: Request) {
  const locales = parseAcceptLanguage(request.headers.get("accept-language"), {
    validate: Intl.DateTimeFormat.supportedLocalesOf,
  });

  return locales[0] ?? "en-US";
}

export function formatDateBasedOnLocaleOnly(value: string, locale: string) {
  return parseISO(value).toLocaleDateString(locale);
}

/**
 * date-only formats are interpreted as UTC when passed to the Date constructor, per ECMAScript
 * So when parsing the date (e.g 13-12-2024) you get local time from the date object.
 * To perfectly parse date-only string we have to parse date as integers.
 * For more information refer to this comment on github - https://github.com/date-fns/date-fns/issues/489#issuecomment-302271425
 *
 * This function converts date-only strings into Date object without making it local.
 * Make sure the date passed to this function is in following format - YYYY-MM-DD
 */
export function parseDateOnlyString(date: string) {
  const [year, month, day] = date.split("-").map(Number);

  return new Date(
    year,
    month - 1, // Converting month to JS format
    day
  );
}
