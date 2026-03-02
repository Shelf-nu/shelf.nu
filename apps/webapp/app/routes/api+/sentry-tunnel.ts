import type { Route } from "./+types/sentry-tunnel";

/**
 * Sentry tunnel endpoint.
 *
 * Proxies Sentry event envelopes through our own domain so they aren't
 * blocked by ad-blockers or browser tracking protection (e.g. Firefox
 * Enhanced Tracking Protection).
 *
 * @see https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option
 */
export async function action({ request }: Route.ActionArgs) {
  try {
    const envelopeBytes = await request.arrayBuffer();
    const envelope = new TextDecoder().decode(envelopeBytes);

    // The first line of the envelope is a JSON header containing the DSN
    const header = envelope.split("\n")[0];
    const dsn = JSON.parse(header).dsn as string;

    if (!dsn) {
      return new Response("Missing DSN in envelope header", { status: 400 });
    }

    const url = new URL(dsn);
    const projectId = url.pathname.replace("/", "");
    const sentryUrl = `https://${url.hostname}/api/${projectId}/envelope/`;

    const sentryResponse = await fetch(sentryUrl, {
      method: "POST",
      body: envelopeBytes,
      headers: {
        "Content-Type": "application/x-sentry-envelope",
      },
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
