/**
 * App-level wiring for booking reminders — the single hook `_layout.tsx`
 * calls to bring the feature to life. Mirrors the shape of
 * {@link file://../quick-actions.ts}: a lib/ hook owning its listeners with
 * proper cleanup.
 *
 * Responsibilities:
 * - One-time init: foreground presentation + Android channel + load the
 *   master toggle, then a forced reconcile so a fresh launch heals any
 *   drift immediately.
 * - Foreground reconcile: every genuine background → foreground transition
 *   re-derives reminders from the server (in-session flaps stay debounced;
 *   leaving the foreground marks the debounce stale).
 * - Tap handling: a reminder tap deep-links to its booking — switching to
 *   the booking's workspace first when it differs from the active one —
 *   for both the warm-start listener and the cold-start "the tap launched
 *   the app" case.
 *
 * All runtime access to expo-notifications goes through the lazy guarded
 * module so pre-notifications builds no-op instead of crashing.
 *
 * @see {@link file://./service.ts} the runtime this hook drives
 * @see {@link file://./notifications-native.ts} the lazy native guard
 */
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import type { NotificationResponse } from "expo-notifications";

import { pushIntoTab } from "@/lib/navigation";
import { useOrg } from "@/lib/org-context";

import { getNotifications } from "./notifications-native";
import {
  initNotificationPresentation,
  loadRemindersPreference,
  markReconcileStale,
  reconcileBookingReminders,
} from "./service";

/** Payload shape attached to every reminder (see plan.ts `data`). */
type ReminderTapData = { bookingId?: string; orgId?: string };

/**
 * The tap that cold-started the app can ALSO be delivered to the warm
 * listener (platform-dependent). Remember handled response ids so one tap
 * never navigates twice (a double push means two back-taps to escape).
 *
 * A response is marked handled only AFTER navigation actually ran — marking
 * on sight would eat a cold-start tap that arrived before the workspace
 * list finished loading, and the retry (the effect re-running once orgs
 * load) would then find it "already handled" and never open the booking.
 */
const handledResponseIds = new Set<string>();

function wasHandled(response: NotificationResponse): boolean {
  return handledResponseIds.has(response.notification.request.identifier);
}

function markHandled(response: NotificationResponse): void {
  handledResponseIds.add(response.notification.request.identifier);
}

/**
 * Extract the tap payload from a notification response, defensively — the
 * payload crosses a native boundary, so treat it as untyped.
 */
function tapDataFromResponse(
  response: NotificationResponse | null | undefined
): { bookingId: string; orgId: string | null } | null {
  const data = response?.notification.request.content.data as
    | ReminderTapData
    | undefined;
  if (typeof data?.bookingId !== "string") return null;
  return {
    bookingId: data.bookingId,
    orgId: typeof data.orgId === "string" ? data.orgId : null,
  };
}

/**
 * Mount-once hook that initializes the reminders runtime, reconciles on
 * foreground, and routes reminder taps to their booking.
 */
export function useBookingReminders(): void {
  const {
    currentOrg,
    organizations,
    setCurrentOrg,
    isLoading: orgLoading,
  } = useOrg();

  /**
   * Open the tapped booking, switching workspaces first when the reminder
   * belongs to a different one (the booking screen fetches org-scoped, so
   * navigating without switching would fail in the wrong workspace).
   * `pushIntoTab` anchors the bookings list beneath the detail so "back"
   * works even when the tab was never mounted (repo navigation rule).
   */
  const openBooking = useCallback(
    (tap: { bookingId: string; orgId: string | null }) => {
      if (tap.orgId && tap.orgId !== currentOrg?.id) {
        const target = organizations.find((org) => org.id === tap.orgId);
        // The user left that workspace — the booking is unreachable; a
        // navigation would just error. Let the tap open the app and stop.
        if (!target) return;
        setCurrentOrg(target);
      }
      pushIntoTab("/(tabs)/bookings", `/(tabs)/bookings/${tap.bookingId}`);
    },
    [currentOrg?.id, organizations, setCurrentOrg]
  );

  // One-time init + launch reconcile.
  useEffect(() => {
    initNotificationPresentation();
    void loadRemindersPreference().then(() =>
      reconcileBookingReminders({ force: true })
    );
  }, []);

  // Self-heal on every genuine return to the foreground. Marking the
  // debounce stale on the way OUT means the next 'active' always
  // reconciles, while rapid in-session flaps stay debounced.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void reconcileBookingReminders();
      } else if (next === "background" || next === "inactive") {
        markReconcileStale();
      }
    });
    return () => sub.remove();
  }, []);

  // Cold start: the app was launched by tapping a reminder. Mirrors the
  // quick-actions pattern — small delay so navigation mounts settle first.
  // Waits for the workspace list (a cross-org tap needs it to switch) and
  // marks the response handled only after navigation ran, so an early run
  // never eats the tap: the effect re-runs once orgs load and retries.
  useEffect(() => {
    if (orgLoading) return;
    const Notifications = getNotifications();
    if (!Notifications) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    (async () => {
      try {
        // why: getLastNotificationResponseAsync is marked deprecated in
        // favour of the useLastNotificationResponse hook, but that hook
        // touches the native module at render time — incompatible with the
        // lazy guard that keeps pre-notifications builds alive. The async
        // getter still works and stays behind the guard.
        const last = await Notifications.getLastNotificationResponseAsync();
        if (!last || wasHandled(last)) return;
        const tap = tapDataFromResponse(last);
        if (tap && !cancelled) {
          timer = setTimeout(() => {
            openBooking(tap);
            markHandled(last);
          }, 300);
        }
      } catch {
        // Partial native availability — no-op.
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [openBooking, orgLoading]);

  // Warm start: a reminder tapped while the app is running/backgrounded.
  // Re-registered when org context changes so the handler always sees the
  // current workspace list (cheap: remove + add). Taps arriving while the
  // workspace list is still loading are left UNhandled — the cold-start
  // effect re-reads the last response once loading finishes and picks
  // them up.
  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;
    try {
      const sub = Notifications.addNotificationResponseReceivedListener(
        (response) => {
          if (orgLoading || wasHandled(response)) return;
          const tap = tapDataFromResponse(response);
          if (tap) {
            openBooking(tap);
            markHandled(response);
          }
        }
      );
      return () => sub.remove();
    } catch {
      // Partial native availability — no listener, no cleanup needed.
      return undefined;
    }
  }, [openBooking, orgLoading]);
}
