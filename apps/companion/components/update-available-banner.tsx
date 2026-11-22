import { useEffect, useState, type ReactNode } from "react";
import { AppState, Platform, Pressable, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import {
  SafeAreaInsetsContext,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { borderRadius, fontSize, hitSlop, spacing } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { getAppVersion, openAppStore } from "@/lib/app-update";
import {
  fetchLatestCompanionVersion,
  getActiveServer,
  subscribeToServerChange,
} from "@/lib/server";
import {
  isUpdateCheckDue,
  UPDATE_BANNER_DISMISSED_KEY,
} from "@/lib/update-banner";
import {
  chooseUpdateBanner,
  type NativeUpdateOutcome,
} from "@/lib/native-update";
import {
  completeNativeUpdate,
  readIosShownStoreVersion,
  runNativeUpdate,
  subscribeToUpdateDownloaded,
} from "@/lib/native-update-runner";
import {
  createNativeUpdateScheduler,
  type UpdateAnswer,
} from "@/lib/native-update-scheduler";

const useStyles = createStyles((colors) => ({
  root: {
    flex: 1,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.primaryBg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  message: {
    flex: 1,
    color: colors.foreground,
    fontSize: fontSize.sm,
    fontWeight: "500",
  },
  updateButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  updateButtonText: {
    color: colors.primaryForeground,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
}));

/** Reads the stored dismissal; a storage failure counts as "never dismissed". */
async function readDismissedVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(UPDATE_BANNER_DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * Wraps the app and offers an update when the active server advertises a newer
 * store version.
 *
 * The offer is the platform's own UI: Google Play's flexible update flow on
 * Android, the App Store sheet on iOS (see `lib/native-update.ts`). The banner
 * below the app has two jobs (`chooseUpdateBanner`): on Android it offers
 * "Restart" once Play has downloaded the update, so the user picks when the
 * app restarts; elsewhere it is the store-link fallback for installs where the
 * native flow is unavailable. Nothing shows while a native attempt is pending,
 * so the store link never flashes ahead of a native sheet.
 *
 * The banner sits in the layout, not over it, so it never covers a tab bar,
 * a floating button or the last rows of a list. While it shows, it takes the
 * bottom safe-area inset itself and hands the screens above an inset of zero;
 * otherwise the tab bar would add the home-indicator gap a second time.
 *
 * Bottom, not top, on purpose: the Android native-stack header always pads
 * itself by the display cutout height (react-native-screens' `CustomToolbar`),
 * whatever inset JS hands it. A top banner therefore leaves a status-bar-sized
 * gap above every stack header on phones with a camera cutout.
 *
 * The tree keeps the same shape whether the banner shows or not. Wrapping the
 * children only while it shows would remount the whole navigator and drop the
 * user's place in the app.
 *
 * Checked at launch, after each server change, and when the app returns to
 * the foreground with no fresh answer (see `isUpdateCheckDue`). Every failure
 * (offline, an old server, an unreadable version) simply shows nothing new: an
 * answer already shown stays until the same server says otherwise.
 *
 * @see ../lib/native-update.ts for when the native flow runs
 * @see ../lib/update-banner.ts for when the fallback banner shows
 */
export function UpdateAvailableBanner({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  // The active server's advertised version. Every answer is a new object, so
  // a re-check that returns the same version is still handed to the scheduler.
  const [answer, setAnswer] = useState<UpdateAnswer>({ version: null });
  const latestVersion = answer.version;
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const [nativeOutcome, setNativeOutcome] =
    useState<NativeUpdateOutcome | null>(null);
  const [restartDismissed, setRestartDismissed] = useState(false);
  // One scheduler per launch. `setNativeOutcome` is stable, so the scheduler
  // never needs rebuilding.
  const [scheduler] = useState(() =>
    createNativeUpdateScheduler({
      platform: Platform.OS,
      getAppVersion,
      readIosShownStoreVersion,
      run: runNativeUpdate,
      onOutcome: setNativeOutcome,
    })
  );

  // Play reports a finished flexible download as an event while this process
  // lives; after a restart it shows up in the next check as `downloaded`.
  useEffect(
    () => subscribeToUpdateDownloaded(() => scheduler.report("downloaded")),
    [scheduler]
  );

  useEffect(() => {
    let mounted = true;

    // Storage is read once. After that, state is the source of truth: `dismiss`
    // writes both, and a tap on X always names a version newer than anything
    // stored, because the banner only shows for a version not yet dismissed.
    void readDismissedVersion().then((stored) => {
      if (mounted) setDismissedVersion((current) => current ?? stored);
    });

    // The server the current answer belongs to, and when it gave it (0: none).
    let answeredBaseUrl = getActiveServer().baseUrl;
    let answeredAt = 0;

    const check = () => {
      const { baseUrl } = getActiveServer();
      if (baseUrl !== answeredBaseUrl) {
        // A different server: the last answer is not this one's to show.
        // Credential refreshes and renames keep the URL, and the answer.
        answeredBaseUrl = baseUrl;
        answeredAt = 0;
        setAnswer({ version: null });
      }
      void fetchLatestCompanionVersion().then((latest) => {
        // Drop an answer from a server the user has since left, and a failed
        // request, which says nothing about the version.
        if (!mounted || latest === undefined) return;
        if (getActiveServer().baseUrl !== baseUrl) return;
        answeredAt = Date.now();
        setAnswer({ version: latest });
      });
    };

    check();
    const unsubscribe = subscribeToServerChange(check);
    const appState = AppState.addEventListener("change", (state) => {
      if (
        state === "active" &&
        isUpdateCheckDue({ answeredAt, now: Date.now() })
      )
        check();
    });
    return () => {
      mounted = false;
      unsubscribe();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    void scheduler.submit(answer);
  }, [scheduler, answer]);

  const banner = chooseUpdateBanner({
    outcome: nativeOutcome,
    // The running bundle's version, which after an OTA comes from the update.
    // That is still the binary's version: `scripts/check-version-sync.mjs`
    // keeps `version` equal to `runtimeVersion`, and an update only reaches
    // binaries with the same runtime version.
    appVersion: getAppVersion(),
    latestVersion,
    dismissedVersion,
    restartDismissed,
  });
  const visible = banner !== null;
  const isRestart = banner === "restart";

  const dismiss = () => {
    if (isRestart) {
      // Session only: the next launch offers the restart again.
      setRestartDismissed(true);
      return;
    }
    if (!latestVersion) return;
    setDismissedVersion(latestVersion);
    AsyncStorage.setItem(UPDATE_BANNER_DISMISSED_KEY, latestVersion).catch(
      () => {
        // Non-fatal: the banner is hidden for this session either way.
      }
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaInsetsContext.Provider
        value={visible ? { ...insets, bottom: 0 } : insets}
      >
        {children}
      </SafeAreaInsetsContext.Provider>
      {visible && (
        <View
          style={[styles.banner, { paddingBottom: insets.bottom + spacing.sm }]}
          accessibilityRole="summary"
        >
          <Ionicons
            name="arrow-up-circle-outline"
            size={20}
            color={colors.primaryText}
          />
          <Text style={styles.message}>
            {isRestart
              ? "An update is ready. Restart Shelf to install it."
              : "A new version of Shelf is available"}
          </Text>
          <Pressable
            style={styles.updateButton}
            onPress={() =>
              void (isRestart ? completeNativeUpdate() : openAppStore())
            }
            accessibilityRole="button"
            accessibilityLabel={isRestart ? "Restart Shelf" : "Update Shelf"}
            accessibilityHint={
              isRestart
                ? "Installs the update and restarts the app"
                : "Opens the app store"
            }
          >
            <Text style={styles.updateButtonText}>
              {isRestart ? "Restart" : "Update"}
            </Text>
          </Pressable>
          <Pressable
            onPress={dismiss}
            hitSlop={hitSlop.md}
            accessibilityRole="button"
            accessibilityLabel="Dismiss update notice"
          >
            <Ionicons name="close" size={20} color={colors.muted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}
