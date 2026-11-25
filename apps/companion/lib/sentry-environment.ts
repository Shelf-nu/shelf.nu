/**
 * Which Sentry environment a companion build reports to, if any.
 *
 * Only real phones report. A simulator or emulator running a release build is
 * a developer testing, and its errors would otherwise land in production next
 * to customer crashes. Real phones report under the environment set for the
 * build (`EXPO_PUBLIC_SENTRY_ENV`), or else under the build's EAS update
 * channel, so a preview build on a tester's phone reads as `preview`.
 *
 * Kept free of React Native and Expo imports so it runs under the Node test
 * runner; `initSentry()` passes in the device and channel values.
 *
 * @see {@link file://./sentry.ts} initSentry, the caller
 * @see {@link file://./sentry-environment.test.ts}
 */

/** What decides where a build's errors go. */
export type SentryEnvironmentInput = {
  /** `false` on a simulator or emulator (`expo-device`'s `isDevice`). */
  isDevice: boolean;
  /** `EXPO_PUBLIC_SENTRY_ENV` for this build, when set. */
  configuredEnvironment: string | undefined;
  /** The build's EAS update channel (`expo-updates`), `null` when unknown. */
  channel: string | null | undefined;
};

/**
 * Resolves the Sentry environment for this build.
 *
 * @param input - Device kind, configured environment and update channel
 * @returns The environment name to report under, or `null` when the build
 *   must not report at all (simulators and emulators)
 */
export function resolveSentryEnvironment({
  isDevice,
  configuredEnvironment,
  channel,
}: SentryEnvironmentInput): string | null {
  if (!isDevice) return null;
  return configuredEnvironment || channel || "production";
}
