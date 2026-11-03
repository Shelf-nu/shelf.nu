/**
 * Queues native update attempts against the server's answers.
 *
 * Answers arrive at launch, after a server change and on a foreground
 * re-check, and any of them can land while an attempt is still running. One
 * attempt runs at a time; an answer that arrives meanwhile is never dropped,
 * the running attempt finishes and the newest answer is evaluated next. An
 * attempt only reports an outcome for the answer it was started for, except
 * when native UI is already on screen or a download is ready, which stay true
 * whatever the server says now.
 *
 * Pure, with its effects passed in, so the Node test runner covers it.
 *
 * @see ./native-update.ts for the rules it applies
 * @see ../components/update-available-banner.tsx for the wiring
 */
import {
  settlesLaunch,
  shouldAttemptNativeUpdate,
  type NativeUpdateOutcome,
  type NativeUpdateResult,
} from "./native-update";

/**
 * One server answer. Every answer is a new object, so a re-check that returns
 * the same version still counts as new (an attempt that found no store update
 * may succeed later in the session).
 */
export type UpdateAnswer = { version: string | null };

/** The effects the scheduler needs. */
export type NativeUpdateSchedulerDeps = {
  /** `Platform.OS`. */
  platform: string;
  /** This build's version; `""` when it cannot be read. */
  getAppVersion: () => string;
  /** The App Store version the iOS sheet was last shown for. Never rejects. */
  readIosShownStoreVersion: () => Promise<string | null>;
  /**
   * Runs one native attempt. Never rejects.
   *
   * @param isCurrent - Whether the attempt's answer is still the newest.
   * @param iosShownStoreVersion - What `readIosShownStoreVersion` returned
   *   for this attempt, so the runner does not read storage again.
   */
  run: (args: {
    isCurrent: () => boolean;
    iosShownStoreVersion: string | null;
  }) => Promise<NativeUpdateResult>;
  /** Receives every outcome that applies to the current answer. */
  onOutcome: (outcome: NativeUpdateOutcome) => void;
};

/** Feeds answers to the scheduler. */
export type NativeUpdateScheduler = {
  /**
   * Hands over a new server answer.
   *
   * @returns Resolves once the queue is idle again, for tests.
   */
  submit: (answer: UpdateAnswer) => Promise<void>;
  /**
   * Reports an outcome learned outside an attempt, such as Play's
   * "download finished" event. It settles the launch.
   */
  report: (outcome: NativeUpdateOutcome) => void;
};

/**
 * Creates the scheduler for one app launch.
 *
 * @param deps - The effects it runs.
 * @returns A scheduler with no answer yet.
 */
export function createNativeUpdateScheduler(
  deps: NativeUpdateSchedulerDeps
): NativeUpdateScheduler {
  let latest: UpdateAnswer | null = null;
  // An answer arrived that no attempt has evaluated yet.
  let pending = false;
  // Launch-wide: nothing new can be learned before the next launch.
  let settled = false;
  // An attempt loop is running. Cleared inside `drain` itself, in the same
  // step as its last look at `pending`, so no answer can land in between.
  let running = false;
  let idle: Promise<void> = Promise.resolve();

  function apply(outcome: NativeUpdateOutcome) {
    if (settlesLaunch(outcome)) settled = true;
    deps.onOutcome(outcome);
  }

  async function drain() {
    running = true;
    try {
      while (pending && latest) {
        pending = false;
        const current = latest;
        const iosShownStoreVersion =
          deps.platform === "ios"
            ? await deps.readIosShownStoreVersion()
            : null;
        // A newer answer arrived during the read: the loop evaluates it.
        if (latest !== current) continue;
        if (
          !shouldAttemptNativeUpdate({
            platform: deps.platform,
            appVersion: deps.getAppVersion(),
            latestVersion: current.version,
            settledThisLaunch: settled,
            iosShownStoreVersion,
          })
        ) {
          continue;
        }
        const result = await deps.run({
          isCurrent: () => latest === current,
          iosShownStoreVersion,
        });
        if (result === "superseded") continue;
        // Native UI on screen, or a finished download, holds whatever the
        // server says now. Any other result belongs to its answer only.
        if (result === "started" || result === "downloaded") {
          apply(result);
          continue;
        }
        if (latest !== current) continue;
        apply(result);
      }
    } finally {
      running = false;
    }
  }

  return {
    submit(answer) {
      latest = answer;
      pending = true;
      if (!running) idle = drain();
      return idle;
    },
    report(outcome) {
      apply(outcome);
    },
  };
}
