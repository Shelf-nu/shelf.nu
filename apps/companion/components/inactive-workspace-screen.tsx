/**
 * What a tab shows while the open workspace is inactive.
 *
 * The mobile API refuses every request in an inactive workspace (a lapsed Team
 * plan, or switched off by a Shelf admin), so each screen would otherwise show
 * its own generic error. This one screen says what is going on, in the
 * server's words, and offers the way out: another workspace, or a fresh check.
 * It never points at a purchase; the owner sorts that out on the web.
 *
 * Settings stays open beside it, so the person can still switch workspace,
 * change preferences and sign out.
 *
 * @see app/(tabs)/_layout.tsx, the one place this renders
 * @see lib/workspace-access.ts
 */
import { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { Organization } from "@/lib/api";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { FORM_MAX_WIDTH } from "@/lib/content-column";
import { useOrg } from "@/lib/org-context";
import { useTheme } from "@/lib/theme-context";
import {
  inactiveWorkspaceMessage,
  isWorkspaceInactive,
} from "@/lib/workspace-access";
import { openWorkspaceSwitcher } from "@/lib/workspace-switcher";

/**
 * @param props.org - The open workspace, which is inactive.
 * @param props.underHeader - Whether the tab draws a header above this screen.
 *   Without one, the screen keeps clear of the status bar itself.
 */
export default function InactiveWorkspaceScreen({
  org,
  underHeader,
}: {
  org: Organization;
  underHeader: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { organizations, currentOrg, setCurrentOrg, refresh } = useOrg();
  const [isChecking, setIsChecking] = useState(false);
  const canSwitch = organizations.some(
    (other) => other.id !== org.id && !isWorkspaceInactive(other)
  );

  /**
   * Re-reads `/me`. Once the workspace is active again, the tab layout stops
   * rendering this screen, so there is no success state to show here.
   */
  const handleCheckAgain = async () => {
    setIsChecking(true);
    try {
      await refresh({ silent: true });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <View
      style={[styles.container, !underHeader && { paddingTop: insets.top }]}
    >
      <View style={styles.content}>
        <Ionicons
          name="pause-circle-outline"
          size={48}
          color={colors.mutedLight}
          accessibilityElementsHidden
        />

        <Text style={styles.title} accessibilityRole="header">
          This workspace is inactive
        </Text>

        <Text style={styles.workspaceName}>{org.name}</Text>

        <Text style={styles.body}>{inactiveWorkspaceMessage(org)}</Text>

        {canSwitch && (
          <TouchableOpacity
            style={styles.button}
            onPress={() =>
              openWorkspaceSwitcher({
                organizations,
                currentOrg,
                onSelect: setCurrentOrg,
              })
            }
            activeOpacity={0.7}
            accessibilityLabel="Switch to another workspace"
            accessibilityRole="button"
          >
            <Text style={styles.buttonText}>Switch workspace</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[
            canSwitch ? styles.secondaryButton : styles.button,
            isChecking && styles.buttonDisabled,
          ]}
          onPress={handleCheckAgain}
          disabled={isChecking}
          activeOpacity={0.7}
          accessibilityLabel="Check again whether this workspace is active"
          accessibilityRole="button"
          accessibilityState={{ disabled: isChecking, busy: isChecking }}
        >
          {isChecking ? (
            <ActivityIndicator
              color={canSwitch ? colors.foreground : colors.primaryForeground}
            />
          ) : (
            <Text
              style={canSwitch ? styles.secondaryButtonText : styles.buttonText}
            >
              Check again
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    width: "100%",
    maxWidth: FORM_MAX_WIDTH,
    alignSelf: "center",
  },
  title: {
    fontSize: fontSize.xxxl,
    fontWeight: "600",
    color: colors.foreground,
    textAlign: "center",
  },
  workspaceName: {
    fontSize: fontSize.md,
    fontWeight: "500",
    color: colors.foreground,
    textAlign: "center",
  },
  body: {
    fontSize: fontSize.md,
    color: colors.foregroundSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  button: {
    alignSelf: "stretch",
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.sm,
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
  secondaryButton: {
    alignSelf: "stretch",
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
  },
}));
