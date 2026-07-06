/**
 * In-app review prompt — asks happy users to rate the app via the OS-native
 * StoreReview sheet, but ONLY after a genuinely successful, satisfying action
 * (completing an audit, fully checking in a booking).
 *
 * It never gates on sentiment ("do you like Shelf?" first) and never offers an
 * incentive — it only ever fires on a success path, so it can only surface
 * satisfied ratings. This is what Apple (App Store Review Guidelines 1.1/3) and
 * Google Play policy require.
 *
 * The OS itself rate-limits the native prompt (iOS shows it only a few times a
 * year, with no display callback), but we add our own guard so we never even
 * ask until the user has had a few wins, and never within ~90 days of a prior
 * ask. Follows the AsyncStorage persistence pattern used by start-page.ts /
 * theme-context.tsx.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// Lazy-load expo-store-review so a build whose native binary predates the module
// (e.g. an older dev client), or a platform without it, degrades gracefully
// instead of crashing at import time. The prompt is best-effort and must never
// block — or crash — the user's flow.
let StoreReview: typeof import("expo-store-review") | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  StoreReview = require("expo-store-review");
} catch {
  StoreReview = null;
}

// ─── Constants ────────────────────────────────────────────────────────────

const SUCCESS_COUNT_KEY = "shelf_review_success_count";
const LAST_PROMPT_KEY = "shelf_review_last_prompt";

/** Only ask once the user has completed this many successful "value" actions. */
const MIN_SUCCESSES_BEFORE_PROMPT = 3;

/** Never re-ask within this window. */
const MIN_DAYS_BETWEEN_PROMPTS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Helper ─────────────────────────────────────────────────────────────────

/**
 * Record a successful "value" moment and, once the thresholds are met, ask the
 * OS to present its native review sheet. Safe to call unconditionally on a
 * success path: it no-ops silently on any error and when review isn't available
 * (dev builds, no Play Store, OS quota already spent).
 */
export async function maybeAskForReview(): Promise<void> {
  try {
    const successes =
      (Number(await AsyncStorage.getItem(SUCCESS_COUNT_KEY)) || 0) + 1;
    await AsyncStorage.setItem(SUCCESS_COUNT_KEY, String(successes));

    if (successes < MIN_SUCCESSES_BEFORE_PROMPT) return;

    const lastPrompt = Number(await AsyncStorage.getItem(LAST_PROMPT_KEY)) || 0;
    if (
      lastPrompt &&
      Date.now() - lastPrompt < MIN_DAYS_BETWEEN_PROMPTS * MS_PER_DAY
    ) {
      return;
    }

    // hasAction() resolves true only when requestReview() can actually present
    // the native sheet (platform supports it, store URL resolved, quota left).
    if (!StoreReview || !(await StoreReview.hasAction())) return;

    await StoreReview.requestReview();
    await AsyncStorage.setItem(LAST_PROMPT_KEY, String(Date.now()));
  } catch {
    // A review prompt must never interfere with the user's flow.
  }
}
