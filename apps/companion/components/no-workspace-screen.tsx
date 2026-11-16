/**
 * What a signed-in user sees when the server offers them no workspace.
 *
 * SSO users are never shown a personal workspace, so one who has not been added
 * to a team workspace yet authenticates successfully and then has nowhere to
 * land. That is a real, expected state on first sign-in — before an admin has
 * assigned them — and after group access is revoked.
 *
 * It is deliberately an ANSWER rather than an empty list: every tab builds its
 * content from `currentOrg`, so without one they each sit on their own loading
 * state indefinitely, telling the user nothing.
 *
 * Mirrors `/sso-pending-assignment` on the web, including the instruction to
 * sign out and back in — group changes are read at sign-in. "Check again" is
 * the mobile addition: there is no page to reload here, and re-reading `/me` is
 * cheaper than a full round trip through the identity provider.
 *
 * @see apps/webapp/app/routes/_welcome+/sso-pending-assignment.tsx
 * @see apps/companion/app/(tabs)/_layout.tsx — the single place this renders
 */
import { useState } from "react";
import { Alert, Text, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  FullScreenNotice,
  NoticeButton,
  NoticeText,
} from "@/components/full-screen-notice";
import { useAuth } from "@/lib/auth-context";
import { fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useOrg } from "@/lib/org-context";
import { useTheme } from "@/lib/theme-context";

export default function NoWorkspaceScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { refresh } = useOrg();
  const { signOut } = useAuth();
  const [isChecking, setIsChecking] = useState(false);

  /**
   * Re-reads `/me`. A successful assignment makes this component stop
   * rendering, because the gate above it sees a non-empty list, so there is no
   * success state to show here, only the absence of one.
   */
  const handleCheckAgain = async () => {
    setIsChecking(true);
    try {
      await refresh();
    } finally {
      setIsChecking(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: signOut },
    ]);
  };

  return (
    <FullScreenNotice
      icon="business-outline"
      title="No workspace assigned"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <NoticeText>
        You don&apos;t currently have access to any workspace in Shelf. This
        usually means your administrator hasn&apos;t assigned you to one yet.
      </NoticeText>

      <NoticeText variant="hint">
        Contact your IT administrator to request access. Once they&apos;ve
        updated your group assignments, sign out and sign back in for the
        changes to take effect.
      </NoticeText>

      <NoticeButton
        label="Check again"
        accessibilityLabel="Check again for a workspace assignment"
        onPress={handleCheckAgain}
        busy={isChecking}
      />

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
    </FullScreenNotice>
  );
}

const useStyles = createStyles((colors) => ({
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  signOutText: {
    fontSize: fontSize.md,
    fontWeight: "500",
    color: colors.error,
  },
}));
