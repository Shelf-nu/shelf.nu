/**
 * Push notification settings.
 *
 * Renders one case of `PushScreenState` (`lib/push/preferences.ts`):
 *
 * - opt-in: an explainer with one button that shows the system prompt where
 *   it can still be shown, records that the person turned notifications on on
 *   this phone, then registers it. It shows on every platform until the
 *   person taps it, including Android 12 and older, which grant the
 *   permission without asking.
 * - denied: notifications are blocked in the phone's settings, with a button
 *   that opens them
 * - unavailable: no workspace plan includes push; the switches show, disabled
 * - ready: the master switch and one switch per category, saved as they flip,
 *   with a notice and "Try again" when this phone's last registration failed
 *
 * The switches belong to the person, not the phone: they apply on every
 * device the person is signed in on, and only to push. Emails are unchanged.
 *
 * @see {@link file://../../../hooks/use-push-settings.ts} reads and writes
 * @see {@link file://../../../lib/push/preferences.ts} the state model
 */
import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { usePushSettings } from "@/hooks/use-push-settings";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import type {
  NotificationPreferenceKey,
  NotificationPreferences,
} from "@/lib/push/preferences";
import { PUSH_CATEGORIES, type PushCategory } from "@/lib/push/routing";
import { useTheme } from "@/lib/theme-context";

/** Label and one-sentence description for each category switch. */
const CATEGORY_COPY: Record<PushCategory, { label: string; hint: string }> = {
  bookings: {
    label: "Bookings",
    hint: "Bookings you are the custodian of: changes, reminders and overdue notices.",
  },
  audits: {
    label: "Audits",
    hint: "Audits assigned to you, reminders before they are due, and overdue notices.",
  },
  stockAndReminders: {
    label: "Stock and reminders",
    hint: "Asset reminders that include you.",
  },
};

/** What the explainer promises, one line per category. */
const EXPLAINER_LINES: {
  icon: "calendar-outline" | "clipboard-outline" | "alarm-outline";
  text: string;
}[] = [
  {
    icon: "calendar-outline",
    text: "A reminder before your booking goes out or is due back, and when it is overdue.",
  },
  {
    icon: "clipboard-outline",
    text: "A heads-up when you are assigned an audit, and before it is due.",
  },
  { icon: "alarm-outline", text: "Asset reminders that include you." },
];

/** The Notifications screen in the Settings stack. */
export default function NotificationsScreen() {
  const { state, turnOn, retryRegistration, setPreference, reload } =
    usePushSettings();
  const styles = useStyles();
  const { colors } = useTheme();
  const [isRequesting, setIsRequesting] = useState(false);

  const handleTurnOn = () => {
    setIsRequesting(true);
    void turnOn()
      .catch(() => {
        Alert.alert(
          "Couldn't turn on notifications",
          "Something went wrong asking for permission. Please try again."
        );
      })
      .finally(() => setIsRequesting(false));
  };

  const handleOpenSettings = () => {
    void Linking.openSettings().catch(() => {
      Alert.alert(
        "Couldn't open Settings",
        "Open your phone's Settings, find Shelf, and allow notifications there."
      );
    });
  };

  switch (state.kind) {
    case "loading":
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );

    case "error":
      return (
        <View style={styles.centered}>
          <Text style={styles.title}>
            Couldn&apos;t load your notification settings
          </Text>
          <Text style={styles.body}>{state.message}</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={reload}
            activeOpacity={0.7}
            accessibilityLabel="Try loading notification settings again"
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );

    case "opt-in":
      return (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
        >
          <Text style={styles.title}>Get notified about your work</Text>
          <View style={styles.card}>
            {EXPLAINER_LINES.map((line) => (
              <View key={line.icon} style={styles.explainerRow}>
                <Ionicons
                  name={line.icon}
                  size={20}
                  color={colors.foreground}
                />
                <Text style={styles.explainerText}>{line.text}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            testID="turn-on-notifications"
            style={[styles.button, isRequesting && styles.buttonDisabled]}
            onPress={handleTurnOn}
            disabled={isRequesting}
            activeOpacity={0.7}
            accessibilityLabel="Turn on notifications"
            accessibilityRole="button"
            accessibilityState={{ disabled: isRequesting, busy: isRequesting }}
          >
            {isRequesting ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.buttonText}>Turn on notifications</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.footnote}>
            You can turn each kind off later. Emails keep arriving as before.
          </Text>
        </ScrollView>
      );

    case "denied":
      return (
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
        >
          <Text style={styles.body}>
            Notifications are off for Shelf in your phone&apos;s settings.
          </Text>
          <TouchableOpacity
            testID="open-system-settings"
            style={styles.button}
            onPress={handleOpenSettings}
            activeOpacity={0.7}
            accessibilityLabel="Open Settings to allow notifications for Shelf"
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Open Settings</Text>
          </TouchableOpacity>
        </ScrollView>
      );

    case "unavailable":
      return (
        <PreferenceSwitches
          preferences={state.preferences}
          disabled
          note="Push notifications are not included in your workspaces' plans."
          onChange={setPreference}
        />
      );

    case "ready":
      return (
        <PreferenceSwitches
          preferences={state.preferences}
          disabled={false}
          onChange={setPreference}
          notice={
            state.registration === "failed" ? (
              <RegistrationFailedNotice onRetry={retryRegistration} />
            ) : null
          }
        />
      );
  }
}

/** Props for {@link RegistrationFailedNotice}. */
type RegistrationFailedNoticeProps = {
  /** Registers this phone again at once. */
  onRetry: () => Promise<void>;
};

/**
 * One line saying this phone could not be connected for push, with a button
 * that tries again at once instead of waiting for the next background retry.
 */
function RegistrationFailedNotice({ onRetry }: RegistrationFailedNoticeProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = () => {
    setIsRetrying(true);
    void onRetry()
      .catch(() => undefined)
      .finally(() => setIsRetrying(false));
  };

  return (
    <View style={styles.notice}>
      <Text style={styles.noticeText}>
        This phone isn&apos;t connected for notifications yet.
      </Text>
      <TouchableOpacity
        testID="retry-push-registration"
        style={styles.noticeButton}
        onPress={handleRetry}
        disabled={isRetrying}
        activeOpacity={0.7}
        accessibilityLabel="Try connecting this phone for notifications again"
        accessibilityRole="button"
        accessibilityState={{ disabled: isRetrying, busy: isRetrying }}
      >
        {isRetrying ? (
          <ActivityIndicator size="small" color={colors.primaryText} />
        ) : (
          <Text style={styles.noticeButtonText}>Try again</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

/** Props for {@link PreferenceSwitches}. */
type PreferenceSwitchesProps = {
  preferences: NotificationPreferences;
  /** Renders every switch read-only. */
  disabled: boolean;
  /** Shown above the switches, saying why they are disabled. */
  note?: string;
  /** Shown above the switches, about this phone's connection. */
  notice?: ReactNode;
  onChange: (key: NotificationPreferenceKey, value: boolean) => void;
};

/**
 * The master switch and the category switches. A category switch is disabled
 * while the master switch is off, since nothing is sent then.
 */
function PreferenceSwitches({
  preferences,
  disabled,
  note,
  notice,
  onChange,
}: PreferenceSwitchesProps) {
  const styles = useStyles();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {notice}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      <View style={styles.card}>
        <PreferenceRow
          label="Push notifications"
          hint="Applies to every phone you are signed in on."
          value={preferences.pushEnabled}
          disabled={disabled}
          onChange={(value) => onChange("pushEnabled", value)}
        />
      </View>
      <View style={styles.card}>
        {PUSH_CATEGORIES.map((category, index) => (
          <View key={category}>
            {index > 0 && <View style={styles.separator} />}
            <PreferenceRow
              label={CATEGORY_COPY[category].label}
              hint={CATEGORY_COPY[category].hint}
              value={preferences[category]}
              disabled={disabled || !preferences.pushEnabled}
              onChange={(value) => onChange(category, value)}
            />
          </View>
        ))}
      </View>
      <Text style={styles.footnote}>
        These switches apply to push notifications only. Emails keep arriving as
        before.
      </Text>
    </ScrollView>
  );
}

/** Props for {@link PreferenceRow}. */
type PreferenceRowProps = {
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
};

/**
 * One labelled switch with its one-sentence description. Screen readers read
 * the row once, as the switch: the label and description are its
 * accessibility label and hint, and the visible texts are hidden from them.
 */
function PreferenceRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: PreferenceRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.row}>
      <View
        style={styles.rowText}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.rowLabel, disabled && styles.rowLabelDisabled]}>
          {label}
        </Text>
        <Text style={styles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          void Haptics.selectionAsync();
          onChange(next);
        }}
        trackColor={{ false: colors.borderLight, true: colors.primary + "60" }}
        thumbColor={value ? colors.primary : colors.mutedLight}
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled }}
      />
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.backgroundSecondary,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.md,
    backgroundColor: colors.backgroundSecondary,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: "600",
    color: colors.foreground,
  },
  body: {
    fontSize: fontSize.md,
    color: colors.foregroundSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  note: {
    fontSize: fontSize.sm,
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },
  footnote: {
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 18,
    textAlign: "center",
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.sm,
  },
  explainerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: 14,
  },
  explainerText: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.foreground,
    lineHeight: 21,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: 14,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: fontSize.base,
    fontWeight: "500",
    color: colors.foreground,
  },
  rowLabelDisabled: {
    color: colors.muted,
  },
  rowHint: {
    fontSize: fontSize.xs,
    color: colors.muted,
    lineHeight: 16,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 14,
  },
  button: {
    alignSelf: "stretch",
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: 14,
    alignItems: "center",
    ...shadows.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: 14,
    backgroundColor: colors.warningBg,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.warning,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 20,
  },
  noticeButton: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  noticeButtonText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.primaryText,
  },
}));
