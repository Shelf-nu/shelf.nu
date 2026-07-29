/**
 * Scan geolocation (best-effort, never blocking)
 *
 * Supplies GPS coordinates for scan provenance — the "where" attached to the
 * recording QR resolve (`GET /api/mobile/qr/:qrId` with the
 * `x-shelf-scan-latitude` / `x-shelf-scan-longitude` headers),
 * bringing the companion to parity with the web QR flow, which posts the
 * browser's geolocation onto the scan record.
 *
 * Design rules (in priority order):
 *
 * 1. **The scan is never gated or delayed on location.** Coordinates come from
 *    a warm in-memory cache or the OS's last-known position; the whole
 *    acquisition is raced against a short timeout ({@link COORDS_TIMEOUT_MS}),
 *    after which the resolve proceeds without coordinates. A fresh GPS fix is
 *    NEVER awaited in the scan hot path — fixes are warmed in the background
 *    so the NEXT scan benefits.
 * 2. **Permission is requested once, lazily, on first scanner use** — via
 *    {@link primeScanLocation} when the scanner screen gains focus. It is
 *    never re-prompted (module flag per session; iOS additionally never
 *    re-shows the system prompt once answered) and never gates any flow:
 *    denied simply means scans carry no coordinates.
 * 3. **Read paths never prompt.** {@link getScanCoordinates} only checks the
 *    already-determined permission state, so callers outside the scanner
 *    (e.g. the deep-link QR resolver) can attach coordinates opportunistically
 *    without ever surfacing a permission dialog mid-navigation.
 *
 * @see {@link file://./../app/(tabs)/scanner.tsx} (primes + attaches on scan)
 * @see {@link file://./deep-links.ts} (attaches opportunistically)
 * @see apps/webapp/app/routes/api+/mobile+/qr.$qrId.ts (the consuming route)
 */

import * as Location from "expo-location";

/** Coordinates in the exact shape the resolve's scan-location headers expect. */
export type ScanCoordinates = { latitude: number; longitude: number };

/**
 * Upper bound on how long a scan may wait for coordinates. Cache reads and
 * `getLastKnownPositionAsync` are near-instant; this only bites when the OS
 * is slow, in which case the scan proceeds without coordinates.
 */
const COORDS_TIMEOUT_MS = 1500;

/**
 * Max age of a position we are willing to attach to a scan. A stale fix is
 * worse than none — "where was this scanned" answered with where the phone
 * was an hour ago is wrong data, not degraded data.
 */
const MAX_FIX_AGE_MS = 5 * 60 * 1000;

/** One lazy permission prompt per app session (rule 2 above). */
let permissionRequested = false;

/** Last permission state we observed, so scan-path checks stay cheap. */
let permissionGranted = false;

/** Freshest position we've obtained, warmed in the background. */
let cachedFix: { coords: ScanCoordinates; timestamp: number } | null = null;

/** Prevents overlapping background fix requests. */
let warmupInFlight = false;

/**
 * Checks (and optionally requests, once per session) foreground location
 * permission.
 *
 * @param requestIfNeeded - When true, shows the system prompt if permission is
 *   still undetermined and we haven't asked this session. Read paths pass
 *   false so they can never surface a dialog.
 * @returns Whether foreground location is granted.
 */
async function ensurePermission(requestIfNeeded: boolean): Promise<boolean> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) {
    permissionGranted = true;
    return true;
  }

  if (!requestIfNeeded || permissionRequested || !current.canAskAgain) {
    permissionGranted = false;
    return false;
  }

  // why: mark before awaiting — a second caller racing in here must not
  // stack a second system prompt.
  permissionRequested = true;
  const requested = await Location.requestForegroundPermissionsAsync();
  permissionGranted = requested.granted;
  return requested.granted;
}

/**
 * Kicks off a background position fix to warm {@link cachedFix}. Fire-and-
 * forget: never awaited by scan paths, so its latency (seconds for a cold GPS)
 * is invisible — it just makes the NEXT coordinate read instant and fresh.
 */
function warmUpFix(): void {
  if (warmupInFlight || !permissionGranted) return;
  warmupInFlight = true;
  Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  })
    .then((pos) => {
      cachedFix = {
        coords: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        },
        timestamp: pos.timestamp,
      };
    })
    .catch(() => {
      // Location unavailable (airplane mode, simulators, …) — scans simply
      // carry no coordinates; never surface this.
    })
    .finally(() => {
      warmupInFlight = false;
    });
}

/**
 * Primes scan geolocation for the scanner: requests permission (once, lazily —
 * this is the ONLY entry point that may show the system prompt) and starts a
 * background fix so the first scan already has warm coordinates.
 *
 * Fire-and-forget; call when the scanner screen gains focus.
 */
export function primeScanLocation(): void {
  void ensurePermission(true)
    .then((granted) => {
      if (granted) warmUpFix();
    })
    .catch(() => {
      // Permission plumbing failed — treat as not granted.
    });
}

/**
 * Best-effort coordinates for a scan happening right now.
 *
 * Resolution order: warm in-memory cache → OS last-known position (both
 * effectively instant) — never a fresh GPS fix. The whole thing is raced
 * against {@link COORDS_TIMEOUT_MS} and any failure returns `null`, so the
 * scan flow is never delayed beyond the timeout and never sees an error.
 * Also re-warms the background fix so subsequent scans get fresher data.
 *
 * @returns Coordinates no older than {@link MAX_FIX_AGE_MS}, or `null`.
 */
export async function getScanCoordinates(): Promise<ScanCoordinates | null> {
  try {
    return await Promise.race([
      acquireCoordinates(),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), COORDS_TIMEOUT_MS)
      ),
    ]);
  } catch {
    // why: coordinates are provenance garnish — any failure (permission
    // plumbing, OS errors) must degrade to "no coords", never to a thrown
    // error inside the scan handler.
    return null;
  }
}

/** The un-raced acquisition path behind {@link getScanCoordinates}. */
async function acquireCoordinates(): Promise<ScanCoordinates | null> {
  // Read paths never prompt (rule 3) — permission comes from priming.
  if (!(await ensurePermission(false))) return null;

  const now = Date.now();

  if (cachedFix && now - cachedFix.timestamp <= MAX_FIX_AGE_MS) {
    // Keep the cache rolling for the next scan of a batch session.
    warmUpFix();
    return cachedFix.coords;
  }

  // No warm cache — fall back to the OS's last-known position, bounded to
  // the same freshness window. Near-instant (no new fix is started).
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: MAX_FIX_AGE_MS,
  });
  warmUpFix();
  if (!lastKnown) return null;

  return {
    latitude: lastKnown.coords.latitude,
    longitude: lastKnown.coords.longitude,
  };
}
