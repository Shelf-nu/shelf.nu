import {
  buildSentryEnvelopeUrl,
  envelopeDsnMatches,
  getConfiguredSentryTarget,
} from "~/utils/sentry-tunnel.server";
import type { Route } from "./+types/sentry-tunnel";

/**
 * Sentry tunnel endpoint.
 *
 * Proxies Sentry event envelopes through our own domain so they aren't
 * blocked by ad-blockers or browser tracking protection (e.g. Firefox
 * Enhanced Tracking Protection).
 *
 * The destination is pinned to the server's own configured Sentry project. The
 * DSN in the client's envelope is only ever compared against it — it never
 * builds the URL we fetch. Deriving the host from the envelope made this a
 * full-read SSRF; see `~/utils/sentry-tunnel.server` for the full account.
 *
 * @see https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 * @see {@link file://./../../utils/sentry-tunnel.server.ts}
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    // Resolved per request rather than at module load so the route stays
    // testable without reaching into the env module.
    const target = getConfiguredSentryTarget();

    if (!target) {
      // No configured Sentry project means there is no legitimate destination.
      // Refusing is the only safe answer — falling back to the envelope's own
      // DSN is exactly the behaviour that made this an SSRF.
      return new Response("Sentry tunnel is not configured", { status: 404 });
    }

    const envelopeBytes = await request.arrayBuffer();
    const envelope = new TextDecoder().decode(envelopeBytes);

    // The first line of the envelope is a JSON header containing the DSN
    const header = envelope.split("\n")[0];
    const dsn = JSON.parse(header).dsn as string;

    if (!dsn) {
      return new Response("Missing DSN in envelope header", { status: 400 });
    }

    if (!envelopeDsnMatches(dsn, target)) {
      // Deliberately does not echo the submitted DSN back: the response would
      // otherwise confirm what was rejected, and the value is attacker-chosen.
      return new Response("Envelope DSN does not match this deployment", {
        status: 403,
      });
    }

    const sentryResponse = await fetch(buildSentryEnvelopeUrl(target), {
      method: "POST",
      body: envelopeBytes,
      headers: {
        "Content-Type": "application/x-sentry-envelope",
      },
      // Never follow redirects. Following them is how the original bug reached
      // internal-only hosts: an attacker-owned host answered the HTTPS request
      // with a 302 to `http://169.254.169.254/...` and fetch chased it. The
      // host is pinned now, but Sentry's ingest does not redirect either, so a
      // 3xx here is unexpected and is surfaced rather than chased.
      redirect: "manual",
    });

    return new Response(sentryResponse.body, {
      status: sentryResponse.status,
      headers: {
        "Content-Type":
          sentryResponse.headers.get("Content-Type") ||
          "application/x-sentry-envelope",
      },
    });
  } catch {
    return new Response("Invalid envelope", { status: 400 });
  }
}
