import type { MiddlewareHandler } from "hono";
import { getPath, getQueryStrings } from "hono/utils/url";

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

export const logger = (): MiddlewareHandler =>
  async function logger(c, next) {
    const { method } = c.req;
    const path = getPath(c.req.raw) + getQueryStrings(c.req.raw.url);

    log(LogPrefix.Incoming, method, path);

    const start = Date.now();

    await next();

    const { status } = new Response(null, c.res);

    log(LogPrefix.Outgoing, method, path, status, time(start));
  };
