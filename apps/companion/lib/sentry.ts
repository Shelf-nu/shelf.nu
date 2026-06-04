/**
 * Sentry instrumentation for the companion app.
 *
 * Two jobs:
 *  1. `initSentry()` — wire up crash/error reporting. No-ops in dev and when no
 *     DSN is configured (the DSN is injected from the EAS env var
 *     `EXPO_PUBLIC_SENTRY_DSN` for preview/production builds, so local Metro
 *     runs never report).
 *  2. `reportAuditDurabilityEvent()` — emit the specific signals that tell us,
 *     WITHOUT waiting for a user to notice corrupted audit data, whether the
 *     offline → kill → sync path is failing in the field. These are the four
 *     danger points of the scan-durability machinery (#2580/#2586). They're
 *     tagged uniformly so we can build targeted Sentry alerts on them.
 *
 * @see {@link file://./audit-scan-persistence.ts}
 * @see {@link file://./../hooks/use-scan-queue.ts}
 * @see {@link file://./../hooks/use-audit-init.ts}
 */
import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Initialise Sentry. Safe to call unconditionally — it no-ops when there is no
 * DSN (local dev) or in `__DEV__`, so we never pollute the project with errors
 * from Expo Go / Metro sessions.
 */
export function initSentry() {
  if (!dsn || __DEV__) {
    if (__DEV__) console.log("[Sentry] disabled (dev or no DSN)");
    return;
  }
  Sentry.init({
    dsn,
    environment: "production",
    // Modest perf sampling — we care about errors + the durability events,
    // not full tracing volume.
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
}

/**
 * The audit scan-durability danger points. If any of these fire in production,
 * the offline/kill/sync path is being stressed or failing — the exact failure
 * class that otherwise only surfaces as a user reporting wrong audit results.
 */
export type AuditDurabilityEvent =
  /** A scan exhausted its sync retries and was moved to the failed queue. */
  | "scan_sync_failed"
  /** An AsyncStorage write returned false — a scan may not have hit disk. */
  | "scan_persist_failed"
  /** "Resume Previous Session?" was shown — a kill left unsynced scans behind. */
  | "session_recovered"
  /** Audit completion was blocked because scans were still unsynced. */
  | "completion_blocked_unsynced";

/**
 * Report a durability event to Sentry. No-ops when Sentry isn't configured.
 *
 * @param event - which danger point fired
 * @param context - structured detail (audit/asset ids, counts) — no PII
 * @param level - Sentry severity; defaults to "warning"
 */
export function reportAuditDurabilityEvent(
  event: AuditDurabilityEvent,
  context: Record<string, unknown> = {},
  level: Sentry.SeverityLevel = "warning"
) {
  if (!dsn || __DEV__) return;
  Sentry.captureMessage(`audit-durability: ${event}`, {
    level,
    tags: { feature: "audit-scan-durability", durability_event: event },
    extra: context,
  });
}
