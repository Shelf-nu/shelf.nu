/**
 * Fly.io HTTP health check endpoint.
 *
 * @see https://fly.io/docs/reference/configuration/#services-http_checks
 *
 * ## "Busy ≠ dead"
 *
 * Fly's health check (`fly.toml`: `services.http_checks`) has a hard 2s
 * timeout. The DB probe below goes through Prisma's pooled connection, and
 * when that pool saturates, the query BLOCKS waiting for a free connection
 * (up to `pool_timeout`, ~20s) instead of failing fast. If we let that block
 * the HTTP response, Fly's 2s check times out, marks the machine unhealthy,
 * and reboots it -- which throws a cold-start connection burst at the
 * already-saturated pooler, crash-looping the whole fleet. This exact chain
 * was confirmed on 2026-07-20: a DB-connectivity storm ran ~09:00-10:11
 * across 6 machine IDs on a 5-machine fleet, interleaved with
 * `Healthcheck failed` events.
 *
 * The fix: race the DB probe against a short internal timeout, well under
 * Fly's 2s budget.
 * - Probe resolves first -> DB is healthy -> 200.
 * - Internal timeout wins first -> the process is alive, just waiting on a
 *   busy pool -> still 200 (with a `degraded: true` body flag), so Fly does
 *   NOT reboot a merely-busy machine. The still-pending probe's eventual
 *   settlement is swallowed so it can never surface as an unhandled
 *   rejection once this request has already responded.
 * - Probe rejects first (e.g. DB unreachable) -> genuine failure -> 503, so
 *   Fly CAN recycle an actually-dead machine.
 */
import { data } from "react-router";

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { Logger } from "~/utils/logger";

/**
 * Internal budget for the DB probe, comfortably under Fly's 2s check
 * timeout (`fly.toml`: `services.http_checks.timeout = "2s"`). Leaves
 * headroom for request routing/serialization so a "busy" verdict still
 * makes it back to Fly inside its window instead of racing it.
 */
export const HEALTHCHECK_DB_TIMEOUT_MS = 1000;

/**
 * Sentinel value resolved by the internal timeout when it wins the race
 * against the DB probe. Distinguishes "timed out" from "probe resolved with
 * an actual (falsy) value" without relying on `undefined`.
 */
const HEALTHCHECK_TIMEOUT = Symbol("healthcheck-timeout");

/**
 * Fly.io HTTP health check loader. See the file-level doc above for the
 * busy-vs-dead rationale.
 *
 * @returns A `data()` response:
 * - `200` when the DB probe resolves in time (healthy), or when the probe is
 *   still pending after {@link HEALTHCHECK_DB_TIMEOUT_MS} (busy, but the
 *   process itself is alive).
 * - `503` only when the probe rejects within the timeout window (a genuine
 *   DB connection failure).
 */
export async function loader() {
  // Deliberately runs against the pooled Prisma client -- a saturated pool is
  // exactly the failure mode this route needs to detect and NOT treat as
  // death.
  const probe = db.user.findFirst({
    select: { id: true },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof HEALTHCHECK_TIMEOUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(HEALTHCHECK_TIMEOUT);
    }, HEALTHCHECK_DB_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([probe, timeout]);

    if (result === HEALTHCHECK_TIMEOUT) {
      // Accepted tradeoff: elapsed time alone can't tell a busy pool apart from
      // a genuinely-broken-but-slow DB path (a wedged socket / stalled TLS
      // handshake that hangs instead of erroring). Both land here and return
      // 200, so a truly-wedged machine could keep receiving traffic. We accept
      // this because the alternative -- rebooting on slowness -- reintroduces
      // the fleet-wide crashloop this route exists to prevent, and because
      // failures that error *quickly* (connection refused, P1001) already fall
      // through to the 503 path below. Distinguishing a *persistently* unhealthy
      // machine from a transient blip needs a consecutive-failure signal (a Fly
      // unhealthy-threshold), not time-based escalation here -- escalating to
      // 503 after N slow checks would re-trigger the cascade under a sustained
      // fleet-wide saturation.

      // why: the probe lost the race but is still in flight. Attach a no-op
      // handler so its eventual rejection can't surface as an unhandled
      // promise rejection after this request has already responded.
      void probe.catch(() => {});

      Logger.warn(
        `Healthcheck: DB probe did not resolve within ${HEALTHCHECK_DB_TIMEOUT_MS}ms. ` +
          "Pool is busy, not dead -- responding 200 so Fly doesn't reboot the machine."
      );
      return data(payload({ status: "OK", degraded: true }), { status: 200 });
    }

    return data(payload({ status: "OK" }), { status: 200 });
  } catch (cause) {
    // Genuine, fast DB failure (e.g. connection refused) -- the machine is
    // actually unhealthy, so let Fly recycle it.
    return data(
      error(
        new ShelfError({
          cause,
          message: "Healthcheck failed",
          label: "Healthcheck",
          shouldBeCaptured: true,
        })
      ),
      { status: 503 }
    );
  } finally {
    // Clears the timer whichever side of the race won -- avoids a dangling
    // timer keeping the event loop busy when the probe wins.
    clearTimeout(timer);
  }
}
