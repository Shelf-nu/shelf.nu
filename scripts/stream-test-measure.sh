#!/usr/bin/env bash
#
# stream-test-measure.sh — probe whether the /stream-test streamed response is
# flushed incrementally or buffered by the proxy in front of the origin.
#
# It hits GET <base>/stream-test?delay=<ms> and reports, per request:
#   ttfb  = time to the FIRST response body byte (curl time_starttransfer)
#   total = time to the LAST byte            (curl time_total)
#
# Interpretation (delay = D ms):
#   STREAMING intact  -> ttfb is small (shell flushes early), total ~ D
#                        i.e. ttfb « total
#   BUFFERED by proxy -> ttfb ~ total ~ D   (whole doc arrives at once)
#
# It runs TWO requests, both with a real-browser User-Agent (the origin routes
# bots to a non-streaming onAllReady path, so a default curl UA would measure
# the wrong thing):
#   1) Accept-Encoding: identity        — no compression
#   2) Accept-Encoding: gzip, deflate, br — the real-browser trigger for
#      Cloudflare's compress-then-buffer behaviour
# If (1) streams but (2) buffers, Cloudflare compression is the culprit.
#
# Usage:
#   scripts/stream-test-measure.sh <base-url> [delay-ms] [cookie]
#     base-url : origin or edge, no trailing slash
#                e.g. https://staging.app.shelf.nu   (through Cloudflare)
#                or   https://<fly-app>.fly.dev       (origin, bypasses Cloudflare)
#                or   http://localhost:3000           (local baseline)
#     delay-ms : deferred-chunk delay (default 2000)
#     cookie   : optional "name=value" session cookie (route is public, usually unneeded)
#
# Tip: run it against the Fly origin AND the Cloudflare hostname. If the origin
# streams (ttfb « total) but the Cloudflare host buffers (ttfb ≈ total), the
# proxy is the problem — not the app.
set -euo pipefail

BASE="${1:?usage: stream-test-measure.sh <base-url> [delay-ms] [cookie]}"
DELAY="${2:-2000}"
COOKIE="${3:-}"

URL="${BASE%/}/stream-test?delay=${DELAY}"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
FMT='   ttfb=%{time_starttransfer}s  total=%{time_total}s  http=%{http_code}  size=%{size_download}B\n'

probe() {
  local label="$1"; shift
  printf '── %s\n' "$label"
  curl -sS -o /dev/null -N \
    -A "$UA" \
    ${COOKIE:+--cookie "$COOKIE"} \
    "$@" \
    -w "$FMT" \
    "$URL" || printf '   (curl failed)\n'
}

printf 'probe: %s   (delay=%sms)\n\n' "$URL" "$DELAY"
probe "no compression   (Accept-Encoding: identity)"       -H 'Accept-Encoding: identity'
probe "real browser     (Accept-Encoding: gzip, deflate, br)" -H 'Accept-Encoding: gzip, deflate, br'
printf '\nread: BUFFERED if ttfb ≈ total ≈ %sms; STREAMING if ttfb is small and total ≈ %sms.\n' "$DELAY" "$DELAY"
