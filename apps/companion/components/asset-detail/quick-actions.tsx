import { memo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ActionSheetIOS,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import type { AssetDetail } from "@/lib/api";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

interface QuickActionsProps {
  asset: AssetDetail;
  onAssignCustody: () => void;
  onReleaseCustody: () => void;
  onLocationPress: () => void;
  onEditPress: () => void;
  onDeletePress: () => void;
  isActionLoading: boolean;
  showOverflowMenu: boolean;
  setShowOverflowMenu: (show: boolean) => void;
  /** Role can change custody (assign/release). Server-enforced; this hides the button. */
  canCustody: boolean;
  /** Role can update the asset (location/edit). */
  canUpdate: boolean;
  /** Role can delete the asset. */
  canDelete: boolean;
}

export const QuickActions = memo(function QuickActions({
  asset,
  onAssignCustody,
  onReleaseCustody,
  onLocationPress,
  onEditPress,
  onDeletePress,
  isActionLoading,
  setShowOverflowMenu,
  canCustody,
  canUpdate,
  canDelete,
}: QuickActionsProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const hasCustody = !!asset.custody;
  const isAvailable = asset.status === "AVAILABLE";
  const showPrimary = canCustody && (hasCustody || isAvailable);
  const showSecondary = canUpdate || canDelete;

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

  // No permitted actions for this role — render nothing rather than an
  // empty padded box or buttons that 403 server-side.
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
            accessibilityLabel="Release custody of asset"
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
            accessibilityLabel="Assign custody of asset"
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

      {/* Secondary actions row */}
      {showSecondary && (
        <View style={styles.secondaryActionsRow}>
          {canUpdate && (
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={onLocationPress}
              activeOpacity={0.7}
              accessibilityLabel="Update location"
              accessibilityRole="button"
            >
              <Ionicons
                name="location-outline"
                size={18}
                color={colors.foreground}
              />
              <Text style={styles.secondaryActionText}>
                {asset.location ? "Move" : "Location"}
              </Text>
            </TouchableOpacity>
          )}
          {canUpdate && (
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={onEditPress}
              activeOpacity={0.7}
              accessibilityLabel="Edit asset"
              accessibilityRole="button"
            >
              <Ionicons
                name="create-outline"
                size={18}
                color={colors.foreground}
              />
              <Text style={styles.secondaryActionText}>Edit</Text>
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={() => {
                if (Platform.OS === "ios") {
                  ActionSheetIOS.showActionSheetWithOptions(
                    {
                      options: ["Cancel", "Delete Asset"],
                      destructiveButtonIndex: 1,
                      cancelButtonIndex: 0,
                      title: "Asset Actions",
                    },
                    (buttonIndex) => {
                      if (buttonIndex === 1) onDeletePress();
                    }
                  );
                } else {
                  setShowOverflowMenu(true);
                }
              }}
              activeOpacity={0.7}
              accessibilityLabel="More actions"
              accessibilityRole="button"
            >
              <Ionicons
                name="ellipsis-horizontal"
                size={18}
                color={colors.muted}
              />
              <Text style={styles.secondaryActionTextMuted}>More</Text>
            </TouchableOpacity>
          )}
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
  secondaryActionTextMuted: {
    color: colors.muted,
    fontSize: fontSize.sm,
    fontWeight: "500",
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
