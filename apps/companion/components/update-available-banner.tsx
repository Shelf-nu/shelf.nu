import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
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
  subscribeToServerChange,
} from "@/lib/server";
import {
  laterDismissal,
  shouldShowUpdateBanner,
  UPDATE_BANNER_DISMISSED_KEY,
} from "@/lib/update-banner";

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
 * Wraps the app and shows a dismissible "new version available" banner below
 * it when the active server advertises a newer store version.
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
 * Checked at launch and after each server switch. Every failure (offline, an
 * old server, an unreadable version) simply shows nothing.
 *
 * @see ../lib/update-banner.ts for when it shows
 */
export function UpdateAvailableBanner({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    // Only the newest check may write: a slow answer from the server the user
    // just left must not overwrite the one they switched to.
    let latestRequest = 0;
    const check = () => {
      const request = ++latestRequest;
      void Promise.all([
        fetchLatestCompanionVersion(),
        readDismissedVersion(),
      ]).then(([latest, dismissed]) => {
        if (request !== latestRequest) return;
        setLatestVersion(latest);
        // Merge, never replace: the user may have tapped X while this check
        // was waiting on the network, after it had already read storage.
        setDismissedVersion((current) => laterDismissal(current, dismissed));
      });
    };
    check();
    const unsubscribe = subscribeToServerChange(check);
    return () => {
      latestRequest += 1;
      unsubscribe();
    };
  }, []);

  const visible = shouldShowUpdateBanner({
    appVersion: getAppVersion(),
    latestVersion,
    dismissedVersion,
  });

  const dismiss = () => {
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
            A new version of Shelf is available
          </Text>
          <Pressable
            style={styles.updateButton}
            onPress={() => void openAppStore()}
            accessibilityRole="button"
            accessibilityLabel="Update Shelf"
            accessibilityHint="Opens the app store"
          >
            <Text style={styles.updateButtonText}>Update</Text>
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
