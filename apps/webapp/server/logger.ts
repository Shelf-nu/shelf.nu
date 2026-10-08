/**
 * Request logger middleware.
 *
 * Writes one stdout line when a request arrives and one when it completes.
 * Those lines are retained by the log pipeline and captured as Sentry
 * breadcrumbs, so the request path is passed through
 * {@link redactRequestTarget} before it is written.
 *
 * @see {@link file://./index.ts} — registered as the first middleware
 * @see {@link file://./../app/utils/redact.ts} — the shared redaction rules
 */
import type { MiddlewareHandler } from "hono";
import { getPath, getQueryStrings } from "hono/utils/url";
import { isSensitiveUrlParam, REDACTED_URL_PART } from "~/utils/redact";

enum LogPrefix {
  Outgoing = "-->",
  Incoming = "<--",
  Error = "xxx",
}

const colorStatus = (status: number) => {
  const out: { [key: string]: string } = {
    7: `\x1b[35m${status}\x1b[0m`,
    5: `\x1b[31m${status}\x1b[0m`,
    4: `\x1b[33m${status}\x1b[0m`,
    3: `\x1b[36m${status}\x1b[0m`,
    2: `\x1b[32m${status}\x1b[0m`,
    1: `\x1b[32m${status}\x1b[0m`,
    0: `\x1b[33m${status}\x1b[0m`,
  };

  const calculateStatus = (status / 100) | 0;

  return out[calculateStatus];
};

const humanize = (times: string[]) => {
  const [delimiter, separator] = [",", "."];

  const orderTimes = times.map((v) =>
    v.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + delimiter)
  );

  return orderTimes.join(separator);
};

const time = (start: number) => {
  const delta = Date.now() - start;
  return humanize([
    delta < 1000 ? delta + "ms" : Math.round(delta / 1000) + "s",
  ]);
};

function log(
  prefix: string,
  method: string,
  path: string,
  status: number = 0,
  elapsed?: string
) {
  const out =
    prefix === LogPrefix.Incoming
      ? `  ${prefix} ${method} ${path}`
      : `  ${prefix} ${method} ${path} ${colorStatus(status)} ${elapsed}`;
  // eslint-disable-next-line no-console
  console.log(out);
}

/**
 * The secret token segment of the subscribable iCal feed path,
 * `/api/calendar/feed/<token>.ics`. The token is the feed's only credential
 * (calendar clients cannot send cookies), so it must never reach a log line.
 *
 * Everything after `/calendar/feed/` is treated as the token, apart from a
 * trailing `.ics`. Case-insensitive and not anchored to `/api`, because the
 * logger runs before routing and sees every request, not only well-formed ones.
 */
const CALENDAR_FEED_TOKEN = /(\/calendar\/feed\/).+?(\.ics)?$/i;

/**
 * Returns the request's path and query string in the form written to the
 * request log. The calendar-feed token and the value of every credential-bearing
 * query parameter (such as the invite link's `?token=`) are replaced with
 * {@link REDACTED_URL_PART}; everything else is kept as received.
 *
 * @param path - The request path, e.g. `/api/calendar/feed/abc.ics`
 * @param query - The query string including its leading `?`, or `""`
 * @returns The path and query string, safe to write to the request log
 */
export function redactRequestTarget(path: string, query: string): string {
  const safePath = path.replace(
    CALENDAR_FEED_TOKEN,
    `$1${REDACTED_URL_PART}$2`
  );

  if (!query) {
    return safePath;
  }

  const params = new URLSearchParams(query);
  let redacted = false;

  for (const name of Array.from(params.keys())) {
    if (isSensitiveUrlParam(name)) {
      params.set(name, REDACTED_URL_PART);
      redacted = true;
    }
  }

  // A clean query is logged exactly as received: `URLSearchParams` re-encodes
  // on the way out, which would make the line differ from the real request.
  return safePath + (redacted ? `?${params.toString()}` : query);
}

export const logger = (): MiddlewareHandler =>
  async function logger(c, next) {
    const { method } = c.req;
    const path = redactRequestTarget(
      getPath(c.req.raw),
      getQueryStrings(c.req.raw.url)
    );

    log(LogPrefix.Incoming, method, path);

    const start = Date.now();

    await next();

    const { status } = new Response(null, c.res);

    log(LogPrefix.Outgoing, method, path, status, time(start));
  };
