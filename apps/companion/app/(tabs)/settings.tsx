import { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  Switch,
} from "react-native";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { Image } from "expo-image";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/lib/auth-context";
import { useOrg } from "@/lib/org-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme, type ThemePreference } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import {
  START_PAGE_OPTIONS,
  getStartPage,
  setStartPage,
  type StartPage,
} from "@/lib/start-page";
import {
  loadScanSoundPreference,
  setScanSoundEnabled,
  playScanSound,
} from "@/lib/scan-sound";

const appVersion =
  Constants.expoConfig?.version ??
  Constants.manifest2?.extra?.expoClient?.version ??
  "0.1.0";

const THEME_OPTIONS: {
  key: ThemePreference;
  label: string;
  icon: "sunny-outline" | "moon-outline" | "phone-portrait-outline";
}[] = [
  { key: "light", label: "Light", icon: "sunny-outline" },
  { key: "dark", label: "Dark", icon: "moon-outline" },
  { key: "system", label: "System", icon: "phone-portrait-outline" },
];

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { currentOrg, organizations, setCurrentOrg, userProfile } = useOrg();
  const { colors, themePreference, setThemePreference } = useTheme();
  const styles = useStyles();

  const [startPage, setStartPageState] = useState<StartPage>("assets");
  const [scanSoundOn, setScanSoundOn] = useState(true);

  // Load persisted start page and scan sound preference on mount
  useEffect(() => {
    getStartPage().then(setStartPageState);
    loadScanSoundPreference().then(setScanSoundOn);
  }, []);

  const handleStartPageChange = (page: StartPage) => {
    Haptics.selectionAsync();
    setStartPageState(page);
    setStartPage(page);
  };

  const displayName = userProfile
    ? [userProfile.firstName, userProfile.lastName].filter(Boolean).join(" ")
    : null;

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: signOut,
      },
    ]);
  };

  const handleSwitchOrg = () => {
    if (organizations.length <= 1) return;

    Alert.alert("Switch Workspace", "Select a workspace:", [
      ...organizations.map((org) => ({
        text: `${org.name}${org.id === currentOrg?.id ? " (current)" : ""}`,
        onPress: () => {
          Haptics.selectionAsync();
          setCurrentOrg(org);
        },
      })),
      { text: "Cancel", style: "cancel" as const },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.card}>
          <View style={styles.profileRow}>
            {userProfile?.profilePicture ? (
              <Image
                source={{ uri: userProfile.profilePicture }}
                style={styles.avatarImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>
                  {(displayName?.[0] || user?.email?.[0] || "?").toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.profileInfo}>
              {displayName ? (
                <>
                  <Text style={styles.profileName}>{displayName}</Text>
                  <Text style={styles.profileEmail}>{user?.email}</Text>
                </>
              ) : (
                <Text style={styles.profileName}>{user?.email}</Text>
              )}
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Workspace</Text>
        <TouchableOpacity
          style={styles.card}
          onPress={handleSwitchOrg}
          disabled={organizations.length <= 1}
          activeOpacity={0.7}
          accessibilityLabel={`Current workspace: ${
            currentOrg?.name ?? "None"
          }${organizations.length > 1 ? ". Tap to switch" : ""}`}
          accessibilityRole="button"
        >
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons
                name="business-outline"
                size={20}
                color={colors.foreground}
              />
              <View>
                <Text style={styles.settingLabel}>
                  {currentOrg?.name ?? "No workspace"}
                </Text>
                {organizations.length > 1 && (
                  <Text style={styles.settingHint}>
                    {organizations.length} workspaces available
                  </Text>
                )}
              </View>
            </View>
            {organizations.length > 1 && (
              <Ionicons
                name="chevron-forward"
                size={20}
                color={colors.mutedLight}
              />
            )}
          </View>
        </TouchableOpacity>
      </View>

      {/* Appearance section with theme toggle */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Appearance</Text>
        <View style={styles.card}>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((option) => {
              const isActive = themePreference === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.themeOption,
                    isActive && styles.themeOptionActive,
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setThemePreference(option.key);
                  }}
                  activeOpacity={0.7}
                  accessibilityLabel={`Theme: ${option.label}${
                    isActive ? ", selected" : ""
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Ionicons
                    name={option.icon}
                    size={18}
                    color={
                      isActive ? colors.filterPillActiveText : colors.muted
                    }
                  />
                  <Text
                    style={[
                      styles.themeOptionText,
                      isActive && styles.themeOptionTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {/* Start page picker */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Start Page</Text>
        <View style={styles.card}>
          <View style={styles.startPageRow}>
            {START_PAGE_OPTIONS.map((option) => {
              const isActive = startPage === option.key;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.startPageOption,
                    isActive && styles.startPageOptionActive,
                  ]}
                  onPress={() => handleStartPageChange(option.key)}
                  activeOpacity={0.7}
                  accessibilityLabel={`Start page: ${option.label}${
                    isActive ? ", selected" : ""
                  }`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isActive }}
                >
                  <Ionicons
                    name={option.icon}
                    size={18}
                    color={
                      isActive ? colors.filterPillActiveText : colors.muted
                    }
                  />
                  <Text
                    style={[
                      styles.startPageOptionText,
                      isActive && styles.startPageOptionTextActive,
                    ]}
                  >
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      {/* Scan sound toggle */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Scanner</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons
                name="volume-medium-outline"
                size={20}
                color={colors.foreground}
              />
              <View>
                <Text style={styles.settingLabel}>Scan sound</Text>
                <Text style={styles.settingHint}>
                  Bleep + haptic on successful scan
                </Text>
              </View>
            </View>
            <Switch
              value={scanSoundOn}
              onValueChange={async (value) => {
                Haptics.selectionAsync();
                setScanSoundOn(value);
                await setScanSoundEnabled(value);
                // Play a preview bleep when turning on
                if (value) {
                  playScanSound();
                }
              }}
              trackColor={{
                false: colors.borderLight,
                true: colors.primary + "60",
              }}
              thumbColor={scanSoundOn ? colors.primary : colors.mutedLight}
              accessibilityLabel="Toggle scan sound"
              accessibilityRole="switch"
            />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingLeft}>
              <Ionicons
                name="information-circle-outline"
                size={20}
                color={colors.foreground}
              />
              <Text style={styles.settingLabel}>Shelf Companion</Text>
            </View>
            <Text style={styles.settingValue}>v{appVersion}</Text>
          </View>
        </View>
      </View>

      {/* Legal links + account actions */}
      <View style={styles.section}>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.settingRow}
            onPress={() =>
              WebBrowser.openBrowserAsync("https://www.shelf.nu/privacy")
            }
            activeOpacity={0.7}
            accessibilityLabel="Privacy Policy"
            accessibilityRole="link"
          >
            <View style={styles.settingLeft}>
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color={colors.foreground}
              />
              <Text style={styles.settingLabel}>Privacy Policy</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.mutedLight} />
          </TouchableOpacity>

          <View style={styles.separator} />

          <TouchableOpacity
            style={styles.settingRow}
            onPress={() => {
              Alert.alert(
                "Delete Account",
                "Account deletion is handled through the Shelf web app. You will be redirected to shelf.nu to complete this process.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Continue",
                    style: "destructive",
                    onPress: () =>
                      WebBrowser.openBrowserAsync(
                        "https://app.shelf.nu/settings/general"
                      ),
                  },
                ]
              );
            }}
            activeOpacity={0.7}
            accessibilityLabel="Delete Account"
            accessibilityRole="button"
          >
            <View style={styles.settingLeft}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
              <Text style={[styles.settingLabel, { color: colors.error }]}>
                Delete Account
              </Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.mutedLight} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.companionFooter}>
        The companion app is an extension of the web application.{"\n"}
        For advanced features, visit{" "}
        <Text
          style={styles.companionFooterLink}
          onPress={() => WebBrowser.openBrowserAsync("https://app.shelf.nu")}
        >
          app.shelf.nu
        </Text>
      </Text>

      <TouchableOpacity
        style={styles.signOutButton}
        onPress={handleSignOut}
        activeOpacity={0.7}
        accessibilityLabel="Sign out of your account"
        accessibilityRole="button"
      >
        <Ionicons name="log-out-outline" size={20} color={colors.error} />
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
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
  },
  section: {
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.sm,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.lg,
    gap: 14,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.gray700,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  avatarText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  profileInfo: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  profileEmail: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  settingRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 14,
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  settingLabel: {
    fontSize: fontSize.base,
    color: colors.foreground,
    fontWeight: "500",
  },
  settingHint: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    marginTop: 1,
  },
  settingValue: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },

  // Theme toggle (segmented control)
  themeRow: {
    flexDirection: "row",
    padding: spacing.sm,
    gap: spacing.xs,
  },
  themeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: borderRadius.md,
    backgroundColor: "transparent",
  },
  themeOptionActive: {
    backgroundColor: colors.filterPillActiveBg,
  },
  themeOptionText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
  },
  themeOptionTextActive: {
    color: colors.filterPillActiveText,
  },

  // Start page picker (segmented control — 4 options)
  startPageRow: {
    flexDirection: "row",
    padding: spacing.sm,
    gap: spacing.xs,
  },
  startPageOption: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: borderRadius.md,
    backgroundColor: "transparent",
  },
  startPageOptionActive: {
    backgroundColor: colors.filterPillActiveBg,
  },
  startPageOptionText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.muted,
  },
  startPageOptionTextActive: {
    color: colors.filterPillActiveText,
  },

  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: 14,
  },
  companionFooter: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  companionFooterLink: {
    color: colors.primary,
    fontWeight: "600",
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.errorBg,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    gap: spacing.sm,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.errorBorder,
  },
  signOutText: {
    color: colors.error,
    fontSize: fontSize.base,
    fontWeight: "600",
  },
}));
