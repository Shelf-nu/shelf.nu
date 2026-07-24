/**
 * Booking reminders runtime — schedules, cancels, and reconciles the local
 * due-back notifications planned by {@link file://./plan.ts}.
 *
 * Design rules (from the launch spec, hardened by review):
 * - The scheduled set is always DERIVED: every sync re-fetches the booking
 *   and rebuilds its reminders from `computeReminderPlan`, so state can
 *   drift (booking returned on web, extended, cancelled) but self-corrects
 *   toward the server's truth on the next sync/reconcile.
 * - A 404/403 on that fetch is an AUTHORITATIVE "gone" (deleted booking, or
 *   the user lost workspace access) and cancels + untracks immediately.
 *   Network/timeout/5xx failures leave state untouched — a stale reminder
 *   the next reconcile removes beats silently dropping a real one.
 * - Absolute-date triggers only — never calendar components — so DST or
 *   timezone changes cannot move a reminder relative to the real due
 *   instant.
 * - Native access goes through {@link file://./notifications-native.ts}: a
 *   build without the expo-notifications module no-ops instead of crashing.
 * - No background execution: the OS delivers scheduled notifications on its
 *   own. Reconcile runs opportunistically on app foreground.
 * - Slow work (the fetch, the interactive permission dialog) happens OUTSIDE
 *   the serialization queue, so a check-in's cancel is never stuck behind an
 *   offline fetch timeout or an open permission prompt.
 *
 * Persistence mirrors the existing lib/scan-sound.ts pattern: AsyncStorage
 * keys with a module-level cached flag, "true"/"false" string values.
 *
 * @see {@link file://./plan.ts} the pure planner (single source of truth)
 * @see {@link file://./use-booking-reminders.ts} the app-level wiring hook
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { api } from "@/lib/api";

import { getNotifications } from "./notifications-native";
import { computeReminderPlan, type ReminderType } from "./plan";

/** Master toggle. Anything other than the literal "false" means enabled. */
const ENABLED_KEY = "shelf_booking_reminders_enabled";
/** JSON map of tracked bookings → their scheduled notification ids. */
const TRACKED_KEY = "shelf_booking_reminders_tracked_v1";
/** Android requires a channel; iOS ignores it. */
const ANDROID_CHANNEL_ID = "booking-reminders";
/**
 * iOS silently keeps at most 64 pending local notifications. Stay under it
 * with headroom so other features (or the OS) never push us over the edge.
 */
const MAX_SCHEDULED = 60;
/**
 * Debounce between reconciles WITHIN one foreground session (rapid
 * active/inactive flaps). A real background → foreground transition resets
 * this via {@link markReconcileStale}, so the spec's "reconcile on every app
 * foreground" holds even when two foregrounds are seconds apart.
 */
const RECONCILE_MIN_INTERVAL_MS = 60_000;

/** One scheduled OS notification belonging to a tracked booking. */
type ScheduledReminder = {
  notificationId: string;
  type: ReminderType;
  /** ISO fire instant — used by the cap to keep the soonest-due first. */
  fireAt: string;
};

/** A booking checked out from this device that we are reminding about. */
type TrackedBooking = {
  bookingId: string;
  /** Needed to re-fetch during reconcile (api calls are org-scoped). */
  orgId: string;
  /** Diagnostic snapshot for debugging/inspection; sync re-derives both. */
  name: string;
  /** Diagnostic: the due instant reminders were last built against. */
  to: string;
  reminders: ScheduledReminder[];
};

type TrackedMap = Record<string, TrackedBooking>;

/** Module-level cache of the master toggle (mirrors scan-sound's pattern). */
let isEnabled = true;
let lastReconcileAt = 0;

/**
 * All tracked-map mutations run through this promise chain, one at a time.
 * Without it, a checkout's sync racing a foreground reconcile could
 * interleave read-modify-write on the map and drop a record — orphaning
 * scheduled notification ids we could then never cancel, which is exactly
 * the "nags about returned gear" failure this feature exists to prevent.
 * Only fast local work runs inside the queue; fetches and permission
 * dialogs stay outside.
 */
let mutationQueue: Promise<void> = Promise.resolve();

function enqueue(task: () => Promise<void>): Promise<void> {
  const run = mutationQueue.then(task, task);
  // Keep the chain alive even when a task rejects (tasks handle their own
  // errors, but a stray rejection must not wedge the queue forever).
  mutationQueue = run.catch(() => {});
  return run;
}

// ── Preference ────────────────────────────────────────────────────────────

/**
 * Load the master toggle from storage into the module cache.
 *
 * @returns The enabled state (default true on missing/error).
 */
export async function loadRemindersPreference(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(ENABLED_KEY);
    isEnabled = stored !== "false";
  } catch {
    isEnabled = true;
  }
  return isEnabled;
}

/**
 * Persist the master toggle and apply it immediately.
 *
 * Turning OFF cancels every scheduled notification but KEEPS the tracked
 * map, so turning back ON can restore reminders for still-ongoing bookings
 * via a forced reconcile (no re-checkout needed).
 *
 * @param enabled - The new toggle state.
 * @returns Whether OS notification permission is currently granted — the
 *   Settings screen uses a false return on enable to point the user at the
 *   OS settings. The preference itself is persisted regardless.
 */
export async function setRemindersEnabled(enabled: boolean): Promise<boolean> {
  isEnabled = enabled;
  try {
    await AsyncStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // Cache still holds the choice for this session; storage retries next set.
  }
  if (!enabled) {
    await enqueue(() => cancelAllScheduled());
    return true;
  }
  // Interactive: the user just flipped the switch, so the OS dialog may show.
  const granted = await ensurePermission(true);
  void reconcileBookingReminders({ force: true });
  return granted;
}

// ── OS plumbing ───────────────────────────────────────────────────────────

/**
 * One-time presentation setup: how reminders render if one fires while the
 * app is foregrounded (quiet banner, no sound — the app's audio culture is
 * scan feedback only), plus the Android channel. Safe to call repeatedly.
 */
export function initNotificationPresentation(): void {
  const Notifications = getNotifications();
  if (!Notifications) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: () =>
        Promise.resolve({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: false,
          shouldSetBadge: false,
        }),
    });
    if (Platform.OS === "android") {
      void Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "Booking reminders",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
  } catch {
    // Partial native availability — degrade to no-op.
  }
}

/**
 * Check (and, when `interactive`, request) notification permission.
 *
 * The request only ever happens on a user-initiated action (first checkout,
 * or flipping the Settings toggle) — never on app launch — per the spec's
 * "ask in context" rule. Runs OUTSIDE the mutation queue: the OS dialog can
 * stay open indefinitely and must not block cancels.
 *
 * @param interactive - Allow showing the OS permission dialog.
 * @returns Whether permission is granted.
 */
async function ensurePermission(interactive: boolean): Promise<boolean> {
  const Notifications = getNotifications();
  if (!Notifications) return false;
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (
      current.status === Notifications.PermissionStatus.UNDETERMINED &&
      interactive
    ) {
      const requested = await Notifications.requestPermissionsAsync();
      return requested.granted;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Tracked-map storage ───────────────────────────────────────────────────

async function readTracked(): Promise<TrackedMap> {
  try {
    const raw = await AsyncStorage.getItem(TRACKED_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // Defensive: a corrupt value must not brick the feature forever.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as TrackedMap;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persist the map. Returns success so callers that just SCHEDULED
 * notifications can roll them back when the ids failed to persist —
 * an unpersisted id is an orphan we could never cancel.
 */
async function writeTracked(map: TrackedMap): Promise<boolean> {
  try {
    await AsyncStorage.setItem(TRACKED_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

// ── Scheduling primitives ─────────────────────────────────────────────────

async function cancelScheduled(reminders: ScheduledReminder[]): Promise<void> {
  const Notifications = getNotifications();
  if (!Notifications) return;
  for (const r of reminders) {
    try {
      await Notifications.cancelScheduledNotificationAsync(r.notificationId);
    } catch {
      // Already fired / already cancelled — fine either way.
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Sync one booking's reminders against the server's current truth.
 *
 * The single write path: re-fetches the booking, cancels whatever was
 * scheduled before, and schedules a fresh plan only when the booking is
 * genuinely out (ONGOING/OVERDUE). Call it after any checkout success and
 * from reconcile — idempotent either way.
 *
 * Failure semantics of the fetch:
 * - 404/403 → authoritative "gone" → cancel + untrack (heals web deletes
 *   and lost workspace access).
 * - any other failure (offline, timeout, 5xx) → leave state untouched and
 *   let a later reconcile heal it.
 *
 * @param bookingId - The booking to sync.
 * @param orgId - Its workspace (api calls are org-scoped).
 * @param opts.interactive - Allow the OS permission prompt (pass true only
 *   from a direct user action, e.g. right after a checkout).
 */
export async function syncBookingReminders(
  bookingId: string,
  orgId: string,
  opts?: { interactive?: boolean }
): Promise<void> {
  // Slow half — fetch + (possibly interactive) permission — OUTSIDE the
  // queue so cancels never wait behind network timeouts or an open dialog.
  let fetched: Awaited<ReturnType<typeof api.booking>>["data"] = null;
  let authoritativelyGone = false;
  try {
    const { data, error, status } = await api.booking(bookingId, orgId);
    if (data) {
      fetched = data;
    } else if (status === 404 || status === 403) {
      authoritativelyGone = true;
    } else if (error || !data) {
      return; // transient failure: leave existing reminders in place
    }
  } catch (e) {
    if (__DEV__) console.warn("[reminders] sync fetch failed:", e);
    return;
  }

  const isOut =
    fetched != null &&
    (fetched.booking.status === "ONGOING" ||
      fetched.booking.status === "OVERDUE");
  const canSchedule =
    isOut && isEnabled
      ? await ensurePermission(opts?.interactive ?? false)
      : false;

  // Fast half — cancel/schedule/persist — serialized on the queue.
  return enqueue(async () => {
    try {
      const map = await readTracked();
      const previous = map[bookingId];
      if (previous) {
        await cancelScheduled(previous.reminders);
        delete map[bookingId];
      }

      if (authoritativelyGone || fetched == null || !isOut) {
        await writeTracked(map);
        return;
      }

      const booking = fetched.booking;
      const record: TrackedBooking = {
        bookingId: booking.id,
        orgId,
        name: booking.name,
        to: booking.to,
        reminders: [],
      };

      // OVERDUE still reaches here — the plan returns nothing for a
      // past-due instant, but a future-due OVERDUE flag (clock skew) is
      // harmless to keep tracking.
      const plan = computeReminderPlan(
        {
          id: booking.id,
          name: booking.name,
          to: booking.to,
          assetCount: booking.assetCount,
          orgId,
        },
        new Date()
      );

      // Track even when we can't schedule (disabled / permission denied):
      // the record is what lets a later enable or permission grant restore
      // reminders through reconcile, without re-checking anything out.
      const Notifications = getNotifications();
      if (plan.length > 0 && canSchedule && Notifications) {
        for (const item of plan) {
          try {
            const notificationId =
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: item.title,
                  body: item.body,
                  data: item.data,
                },
                trigger: {
                  type: Notifications.SchedulableTriggerInputTypes.DATE,
                  date: item.fireAt,
                  ...(Platform.OS === "android"
                    ? { channelId: ANDROID_CHANNEL_ID }
                    : {}),
                },
              });
            record.reminders.push({
              notificationId,
              type: item.type,
              fireAt: item.fireAt.toISOString(),
            });
          } catch (e) {
            if (__DEV__) console.warn("[reminders] schedule failed:", e);
          }
        }
      }

      map[bookingId] = record;
      if (!(await writeTracked(map))) {
        // Ids that never persisted are ids we could never cancel — roll the
        // schedules back so storage failure can't create eternal reminders.
        await cancelScheduled(record.reminders);
        return;
      }
      await enforceScheduleCap();
    } catch (e) {
      if (__DEV__) console.warn("[reminders] sync failed:", e);
    }
  });
}

/**
 * Cancel a booking's reminders immediately and stop tracking it.
 *
 * Used when we KNOW the booking closed on this device (checked in fully,
 * cancelled, archived, deleted) — no fetch needed, and unlike sync it also
 * works for a booking that no longer exists on the server.
 *
 * @param bookingId - The booking whose reminders should disappear.
 */
export function cancelBookingReminders(bookingId: string): Promise<void> {
  return enqueue(async () => {
    try {
      const map = await readTracked();
      const record = map[bookingId];
      if (!record) return;
      await cancelScheduled(record.reminders);
      delete map[bookingId];
      await writeTracked(map);
    } catch (e) {
      if (__DEV__) console.warn("[reminders] cancel failed:", e);
    }
  });
}

/**
 * Cancel everything and forget it — scheduled notifications AND the tracked
 * map. For sign-out: after it, fetches would 401 forever, so tracked
 * records could never heal and reminders would fire for bookings the next
 * account has no business hearing about.
 */
export function clearAllBookingReminders(): Promise<void> {
  return enqueue(async () => {
    try {
      const map = await readTracked();
      for (const record of Object.values(map)) {
        await cancelScheduled(record.reminders);
      }
      await writeTracked({});
    } catch (e) {
      if (__DEV__) console.warn("[reminders] clear-all failed:", e);
    }
  });
}

/**
 * Re-derive every tracked booking's reminders from the server — the
 * self-healing pass that runs on app foreground.
 *
 * Debounced within a foreground session (unless forced); a genuine
 * background → foreground transition resets the debounce via
 * {@link markReconcileStale}. Each booking then goes through
 * {@link syncBookingReminders}, which cancels reminders for anything
 * returned/extended/cancelled elsewhere and reschedules anything whose due
 * time moved.
 *
 * @param opts.force - Skip the debounce (used by launch + Settings toggle).
 */
export async function reconcileBookingReminders(opts?: {
  force?: boolean;
}): Promise<void> {
  const now = Date.now();
  if (!opts?.force && now - lastReconcileAt < RECONCILE_MIN_INTERVAL_MS) return;
  lastReconcileAt = now;

  try {
    const map = await readTracked();
    for (const record of Object.values(map)) {
      await syncBookingReminders(record.bookingId, record.orgId, {
        interactive: false,
      });
    }
  } catch (e) {
    if (__DEV__) console.warn("[reminders] reconcile failed:", e);
  }
}

/**
 * Reset the reconcile debounce. Called when the app leaves the foreground,
 * so the NEXT return to foreground always reconciles — the moment the spec
 * cares about (a booking may have been returned on another device while
 * this one was away) — while rapid in-session flaps stay debounced.
 */
export function markReconcileStale(): void {
  lastReconcileAt = 0;
}

// ── Internals ─────────────────────────────────────────────────────────────

/**
 * Cancel every scheduled notification but keep the tracked records, so the
 * master toggle can be flipped back on and reconcile restores everything.
 * Runs inside the queue (callers enqueue it).
 */
async function cancelAllScheduled(): Promise<void> {
  const map = await readTracked();
  for (const record of Object.values(map)) {
    await cancelScheduled(record.reminders);
    record.reminders = [];
  }
  await writeTracked(map);
}

/**
 * Keep our pending notifications under the iOS 64 cap (with headroom).
 *
 * Counts only FUTURE-dated reminders (a fired one is no longer pending on
 * the OS side; counting it would evict genuinely pending ones) and prunes
 * fired entries from the records while at it. Drops the FURTHEST-OUT first
 * — the soonest-due are the ones a person most needs — and warns
 * unconditionally (not just in dev) so a drop is never silent. Dropped
 * reminders come back automatically on a later reconcile once capacity
 * frees (each sync rebuilds a booking's full plan). Runs inside the queue.
 */
async function enforceScheduleCap(): Promise<void> {
  const map = await readTracked();
  const now = Date.now();
  const pending: { bookingId: string; reminder: ScheduledReminder }[] = [];
  let prunedFired = false;

  for (const record of Object.values(map)) {
    const stillPending = record.reminders.filter(
      (r) => new Date(r.fireAt).getTime() > now
    );
    if (stillPending.length !== record.reminders.length) {
      record.reminders = stillPending;
      prunedFired = true;
    }
    for (const reminder of stillPending) {
      pending.push({ bookingId: record.bookingId, reminder });
    }
  }

  if (pending.length <= MAX_SCHEDULED) {
    if (prunedFired) await writeTracked(map);
    return;
  }

  pending.sort(
    (a, b) =>
      new Date(a.reminder.fireAt).getTime() -
      new Date(b.reminder.fireAt).getTime()
  );
  const overflow = pending.slice(MAX_SCHEDULED);
  // why: unconditional — the spec says capping is "never silent", and in
  // production this warning is the only trace (it also lands in Sentry
  // breadcrumbs, which capture console.warn).
  console.warn(
    `[reminders] over the ${MAX_SCHEDULED} pending cap — dropping ${overflow.length} furthest-out reminder(s)`
  );
  const Notifications = getNotifications();
  for (const { bookingId, reminder } of overflow) {
    if (Notifications) {
      try {
        await Notifications.cancelScheduledNotificationAsync(
          reminder.notificationId
        );
      } catch {
        // Best effort — worst case iOS drops one itself.
      }
    }
    const record = map[bookingId];
    if (record) {
      record.reminders = record.reminders.filter(
        (r) => r.notificationId !== reminder.notificationId
      );
    }
  }
  await writeTracked(map);
}
