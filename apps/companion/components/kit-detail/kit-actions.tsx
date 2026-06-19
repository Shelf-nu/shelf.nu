/**
 * KitActions — the kit detail screen's action row: a primary custody button
 * (Assign when available / Release when in custody) and a secondary
 * Move-location button. Mirrors the asset `QuickActions` component, scoped to
 * the actions a kit supports today via the existing `kits.bulk-actions`
 * endpoint (custody + location). Edit/delete stay web-first for now.
 *
 * @see {@link file://../asset-detail/quick-actions.tsx} the asset twin
 * @see {@link file://../../hooks/use-kit-actions.ts} the action handlers
 */
import { memo } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import type { KitDetail } from "@/lib/api/types";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

interface KitActionsProps {
  kit: KitDetail;
  onAssignCustody: () => void;
  onReleaseCustody: () => void;
  onLocationPress: () => void;
  isActionLoading: boolean;
  /** Role can change custody (assign/release). Server-enforced; hides the button. */
  canCustody: boolean;
  /** Role can update the kit (location). Server-enforced; hides the button. */
  canUpdate: boolean;
}

/**
 * Renders the kit's primary custody action + secondary location action,
 * gated by the caller's permissions (the server re-enforces both).
 *
 * @param props - The kit, action callbacks, loading flag, and permission flags.
 * @returns The action row, a loading row while an action is in flight, or
 *   `null` when the role can perform no actions.
 */
export const KitActions = memo(function KitActions({
  kit,
  onAssignCustody,
  onReleaseCustody,
  onLocationPress,
  isActionLoading,
  canCustody,
  canUpdate,
}: KitActionsProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const hasCustody = !!kit.custody;
  const isAvailable = kit.status === "AVAILABLE";
  const showPrimary = canCustody && (hasCustody || isAvailable);
  const showSecondary = canUpdate;

  if (isActionLoading) {
    return (
      <View style={styles.actionsSection}>
        <View style={styles.actionLoading}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={styles.actionLoadingText}>Updating...</Text>
        </View>
      </View>
    );
  }

  // No permitted actions for this role — render nothing rather than buttons
  // that would 403 server-side.
  if (!showPrimary && !showSecondary) return null;

  return (
    <View style={styles.actionsSection}>
      {/* Primary action — custody assign/release */}
      {showPrimary &&
        (hasCustody ? (
          <TouchableOpacity
            style={styles.primaryActionGreen}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onReleaseCustody();
            }}
            activeOpacity={0.7}
            accessibilityLabel="Release custody of kit"
            accessibilityRole="button"
          >
            <Ionicons
              name="person-remove-outline"
              size={20}
              color={colors.primaryForeground}
            />
            <Text style={styles.primaryActionText}>Release Custody</Text>
          </TouchableOpacity>
        ) : isAvailable ? (
          <TouchableOpacity
            style={styles.primaryActionBlack}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onAssignCustody();
            }}
            activeOpacity={0.7}
            accessibilityLabel="Assign custody of kit"
            accessibilityRole="button"
          >
            <Ionicons
              name="person-add-outline"
              size={20}
              color={colors.primaryForeground}
            />
            <Text style={styles.primaryActionText}>Assign Custody</Text>
          </TouchableOpacity>
        ) : null)}

      {/* Secondary action — location */}
      {showSecondary && (
        <View style={styles.secondaryActionsRow}>
          <TouchableOpacity
            style={styles.secondaryAction}
            onPress={onLocationPress}
            activeOpacity={0.7}
            accessibilityLabel="Update kit location"
            accessibilityRole="button"
          >
            <Ionicons
              name="location-outline"
              size={18}
              color={colors.foreground}
            />
            <Text style={styles.secondaryActionText}>
              {kit.location ? "Move" : "Location"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

const useStyles = createStyles((colors, shadows) => ({
  actionsSection: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  primaryActionBlack: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    gap: spacing.sm,
    ...shadows.sm,
  },
  primaryActionGreen: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.available,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    gap: spacing.sm,
    ...shadows.sm,
  },
  primaryActionText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
  secondaryActionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  secondaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.gray300,
    gap: 4,
  },
  secondaryActionText: {
    color: colors.gray700,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  actionLoading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionLoadingText: { fontSize: fontSize.base, color: colors.muted },
}));
