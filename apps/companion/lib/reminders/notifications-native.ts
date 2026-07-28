/**
 * Lazy, guarded access to the expo-notifications native module.
 *
 * expo-notifications calls `requireNativeModule(...)` at MODULE TOP LEVEL,
 * so a static `import * as Notifications from "expo-notifications"` crashes
 * at bundle-evaluation time on any binary built before the module was added
 * (e.g. a teammate's older dev client pulling this branch, or an OTA update
 * reaching a pre-notifications build). Call-site try/catch cannot help — the
 * throw happens before any function runs.
 *
 * This wrapper defers the require to first use and memoizes the result, so
 * builds without the native module degrade to a feature-wide no-op instead
 * of a startup crash. Type-only imports of expo-notifications are safe
 * anywhere (erased at compile time); RUNTIME access must go through
 * {@link getNotifications}.
 *
 * @see {@link file://./service.ts} the only intended consumer
 */
import type * as ExpoNotifications from "expo-notifications";

/** The full expo-notifications API surface, or null when unavailable. */
export type NotificationsModule = typeof ExpoNotifications;

/** `undefined` = not yet attempted; `null` = attempted and unavailable. */
let cached: NotificationsModule | null | undefined;

/**
 * Load expo-notifications on first use.
 *
 * @returns The module, or null when the native side is absent (older build).
 */
export function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  try {
    // why: a static import evaluates the package's top-level
    // requireNativeModule() and crashes pre-notifications builds at startup;
    // a guarded require is the only way to degrade gracefully.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require("expo-notifications") as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}
