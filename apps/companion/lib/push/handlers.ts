/**
 * App-level push wiring, mounted once in `app/_layout.tsx`.
 *
 * - {@link configureNotificationPresentation} decides how a push that arrives
 *   while the app is open is shown. Called once at module scope.
 * - {@link usePushRegistration} keeps this device registered while someone is
 *   signed in: when the session appears, when the OS reports a new device
 *   token, and when the app returns to the foreground (the stored record makes
 *   that a no-op for 24 hours), once the person opted in on this phone.
 * - {@link usePushTapHandler} opens the screen a tapped push is about,
 *   switching workspace first when the push belongs to another one.
 *
 * @see {@link file://./routing.ts} payload to screen
 * @see {@link file://./registration.ts} the token calls
 */
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "../auth-context";
import { useOrg } from "../org-context";
import { pushIntoTab } from "../navigation";
import { registerThisDevice } from "./registration";
import { acceptTap, nextTapStep, type PushRoute } from "./routing";

/**
 * Shows a push that arrives in the foreground as a banner with sound, and
 * keeps it in Notification Center. The app sets no badge count.
 *
 * Call once, at module scope, before the first notification can arrive.
 */
export function configureNotificationPresentation(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Registers this device whenever a signed-in person could need it: when the
 * session appears, when the OS reports a new device token, and when the app
 * returns to the foreground.
 *
 * These runs are background runs: none prompts, none runs before the person
 * opted in through the Notifications explainer, and each waits out the
 * interval after a failure, the token listener's run included.
 */
export function usePushRegistration(): void {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!userId) return;

    void registerThisDevice();
    const tokenSubscription = Notifications.addPushTokenListener(
      (deviceToken) => void registerThisDevice({ reported: deviceToken })
    );
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void registerThisDevice();
    });

    return () => {
      tokenSubscription.remove();
      appState.remove();
    };
  }, [userId]);
}

/**
 * Identifier of the last tap handled. Module scope, so a remount of the root
 * layout does not open the launch tap a second time, and the cold-start read
 * and the listener cannot both act on the same tap.
 */
let lastHandledTapId: string | null = null;

/**
 * Marks a tap as handled and clears it from expo-notifications, so the next
 * cold-start read does not return it again.
 */
function markTapHandled(tapId: string): void {
  lastHandledTapId = tapId;
  try {
    Notifications.clearLastNotificationResponse();
  } catch {
    // Without the clear, the module-scope id still stops a second open.
  }
}

/** A tap waiting to be opened. */
type PendingTap = { tapId: string; route: PushRoute };

/**
 * Opens the screen a tapped push is about.
 *
 * Covers both a tap that launches the app (read once on mount) and a tap
 * while it runs. `nextTapStep` (`./routing.ts`) decides each step: wait for
 * the session, the workspaces and the tabs, switch to the push's workspace
 * when it differs, then open the screen. A tap stays stored in
 * expo-notifications until it is opened or let go, so a remount before then
 * reads it again.
 */
export function usePushTapHandler(): void {
  const { session, isLoading: authLoading } = useAuth();
  const {
    organizations,
    currentOrg,
    visitOrg,
    isLoading: orgsLoading,
    error: orgsError,
  } = useOrg();
  const segments = useSegments();
  const inTabs = segments[0] === "(tabs)";
  const currentOrgId = currentOrg?.id ?? null;
  const [pending, setPending] = useState<PendingTap | null>(null);

  useEffect(() => {
    let mounted = true;

    const accept = (response: Notifications.NotificationResponse) => {
      if (!mounted) return;
      const acceptance = acceptTap(
        {
          actionIdentifier: response.actionIdentifier,
          tapId: response.notification.request.identifier,
          data: response.notification.request.content.data,
        },
        {
          defaultAction: Notifications.DEFAULT_ACTION_IDENTIFIER,
          lastHandledTapId,
        }
      );
      switch (acceptance.kind) {
        case "ignore":
          return;
        case "handled":
          // A push about nothing the app can open only brings the app forward.
          markTapHandled(acceptance.tapId);
          return;
        case "pending":
          setPending({ tapId: acceptance.tapId, route: acceptance.route });
          return;
      }
    };

    try {
      const launchResponse = Notifications.getLastNotificationResponse();
      if (launchResponse) accept(launchResponse);
    } catch {
      // No stored response to read; a tap while running still arrives below.
    }
    const subscription =
      Notifications.addNotificationResponseReceivedListener(accept);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const step = nextTapStep({
      pending: pending?.route ?? null,
      authLoading,
      hasSession: Boolean(session),
      orgsLoading,
      orgsFailed: Boolean(orgsError),
      inTabs,
      organizations,
      currentOrgId,
    });
    switch (step.kind) {
      case "none":
      case "wait":
        return;
      case "switch-org":
        // This effect runs again once the switch lands, and opens then. The
        // switch is for this visit: the person's chosen workspace stays.
        visitOrg(step.organization);
        return;
      case "drop":
      case "open":
        if (pending) markTapHandled(pending.tapId);
        setPending(null);
        if (step.kind === "open") {
          pushIntoTab(step.tabRoot, step.href ?? undefined);
        }
        return;
    }
  }, [
    pending,
    authLoading,
    session,
    orgsLoading,
    orgsError,
    inTabs,
    organizations,
    currentOrgId,
    visitOrg,
  ]);
}
