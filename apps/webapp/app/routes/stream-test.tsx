/**
 * Temporary streaming / proxy-buffering probe (`GET /stream-test`).
 *
 * Answers, before the advanced-index streaming rebuild commits to it: does the
 * Cloudflare proxy in front of the Fly origin flush a chunked/streamed response
 * incrementally — on BOTH the initial HTML document AND the React Router
 * Single-Fetch `.data` (turbo-stream) path — or buffer it into one batch?
 *
 * The loader returns a realistic payload: 100 synchronous `items` plus TWO
 * STAGGERED deferred promises (`a` at `?delay`, `b` at 1.5×`delay`), each
 * resolving a `Map` of 100 rows × several string columns — mirroring the real
 * per-column hydration batches, so Cloudflare's size-sensitive buffering and the
 * turbo-stream `Map` decode (does `map.get()` survive the wire?) are exercised
 * for real, not by a one-field toy promise. A `Set-Cookie` header rides along to
 * confirm cookies survive the streamed response.
 *
 * Read (with `scripts/stream-test-measure.sh`, and the browser Network panel for
 * per-batch flush): streaming intact → shell TTFB « `a` settle « `b` settle;
 * buffered → everything lands together at ~1.5×`delay`.
 *
 * Public by design (root loader tolerates an absent session) so it can be probed
 * anonymously. Throwaway — deleted once Cloudflare behaviour is confirmed.
 *
 * @see apps/webapp/app/entry.server.tsx (onShellReady + streamTimeout)
 * @see scripts/stream-test-measure.sh
 */
import { Suspense } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Await, useLoaderData } from "react-router";

/** Default base delay (ms) for promise `a`; `b` settles at 1.5× this. */
const DEFAULT_DELAY_MS = 2000;
/** Row count in the synthetic payload — matches a full advanced-index page. */
const ROW_COUNT = 100;

/** One hydrated batch row (several string columns), keyed by row id in a Map. */
type BatchRow = Record<string, string>;

function buildBatchMap(delayMs: number, cols: number): Map<string, BatchRow> {
  const map = new Map<string, BatchRow>();
  for (let i = 0; i < ROW_COUNT; i++) {
    const row: BatchRow = {};
    for (let c = 0; c < cols; c++) {
      row[`col${c}`] = `r${i}c${c}-${delayMs}ms`;
    }
    map.set(`row${i}`, row);
  }
  return map;
}

function afterDelay<T>(ms: number, value: () => T): Promise<T> {
  return new Promise<T>((resolve) => setTimeout(() => resolve(value()), ms));
}

export const meta = () => [{ title: "Stream test" }];

export function headers() {
  return {
    // Fresh origin hit every measurement, and prove Set-Cookie survives the stream.
    "Cache-Control": "no-store",
    "Set-Cookie": "streamprobe=1; Path=/; Max-Age=60; SameSite=Lax",
  };
}

// Synchronous: returns immediately with two unresolved promises — nothing to await.
export function loader({ request }: LoaderFunctionArgs) {
  const requested = Number(new URL(request.url).searchParams.get("delay"));
  const delayMs =
    Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_DELAY_MS;
  const delayB = Math.round(delayMs * 1.5);

  const items = Array.from({ length: ROW_COUNT }, (_, i) => ({
    id: `row${i}`,
    title: `Item ${i}`,
    code: `SAM-${String(i).padStart(4, "0")}`,
  }));

  // UNAWAITED, staggered: React Router streams each as its own deferred chunk.
  const a = afterDelay(delayMs, () => buildBatchMap(delayMs, 6));
  const b = afterDelay(delayB, () => buildBatchMap(delayB, 3));

  return {
    shellRenderedAt: new Date().toISOString(),
    delayMs,
    delayB,
    items,
    a,
    b,
  };
}

/** Renders a Map value for the first row — proves the decoded Map supports .get(). */
function BatchProbe({
  label,
  map,
}: {
  label: string;
  map: Map<string, BatchRow>;
}) {
  const first = map.get("row0");
  return (
    <p data-testid={`deferred-${label}`}>
      ✅ <strong>{label}</strong> arrived — {map.size} rows via Map.get();
      row0.col0 = <code>{first ? first.col0 : "MISSING (.get failed!)"}</code>
    </p>
  );
}

export default function StreamTest() {
  const { shellRenderedAt, delayMs, delayB, items, a, b } =
    useLoaderData<typeof loader>();

  return (
    <main
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        padding: 24,
        lineHeight: 1.7,
        maxWidth: 720,
      }}
    >
      <h1>Streaming / Cloudflare buffering probe (.data)</h1>
      <p data-testid="shell">
        <strong>SHELL</strong> at {shellRenderedAt} — {items.length} items;
        deferred a=@{delayMs}ms, b=@{delayB}ms. Shell should paint immediately.
      </p>
      <Suspense fallback={<p data-testid="pending-a">⏳ batch A pending…</p>}>
        <Await resolve={a}>{(map) => <BatchProbe label="A" map={map} />}</Await>
      </Suspense>
      <Suspense fallback={<p data-testid="pending-b">⏳ batch B pending…</p>}>
        <Await resolve={b}>{(map) => <BatchProbe label="B" map={map} />}</Await>
      </Suspense>
    </main>
  );
}
