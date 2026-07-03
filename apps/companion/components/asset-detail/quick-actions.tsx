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
  /**
   * QUANTITY_TRACKED rendering. When true the green "Release Custody" primary
   * is never shown (release moves to the per-holder custody rows on the
   * detail screen — the whole-asset release endpoint would drop EVERY
   * custodian's units at once) and "Assign Custody" is offered whenever
   * `canCustody`, disabled with a hint when nothing is assignable.
   * Default false: INDIVIDUAL rendering, byte-identical to before.
   */
  isQtyTracked?: boolean;
  /**
   * Assign cap for QUANTITY_TRACKED assets (breakdown `custodyAvailable`
   * with client-side fallbacks). `<= 0` disables the Assign button.
   * Undefined (older server) leaves it enabled — the server still validates.
   */
  custodyAvailable?: number;
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
  isQtyTracked = false,
  custodyAvailable,
}: QuickActionsProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const hasCustody = !!asset.custody;
  const isAvailable = asset.status === "AVAILABLE";
  // QUANTITY_TRACKED: the primary is always Assign (release lives on the
  // per-holder rows), regardless of status — a partially-custodied QT asset
  // can be IN_CUSTODY yet still have units to assign.
  const showPrimary = canCustody && (isQtyTracked || hasCustody || isAvailable);
  const showSecondary = canUpdate || canDelete;
  // Disabled only when the server SENT a cap and it is exhausted; an absent
  // cap (older server) keeps the button live and lets the server validate.
  const assignQtyDisabled =
    isQtyTracked &&
    typeof custodyAvailable === "number" &&
    custodyAvailable <= 0;

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
        (isQtyTracked ? (
          /* QUANTITY_TRACKED: always Assign; per-holder release lives on the
             custody rows. Never routes to the whole-asset release endpoint. */
          <>
            <TouchableOpacity
              style={[
                styles.primaryActionBlack,
                assignQtyDisabled && styles.primaryActionDisabled,
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                onAssignCustody();
              }}
              disabled={assignQtyDisabled}
              activeOpacity={0.7}
              accessibilityLabel="Assign custody of asset"
              accessibilityRole="button"
              accessibilityState={{ disabled: assignQtyDisabled }}
            >
              <Ionicons
                name="person-add-outline"
                size={20}
                color={colors.primaryForeground}
              />
              <Text style={styles.primaryActionText}>Assign Custody</Text>
            </TouchableOpacity>
            {assignQtyDisabled && (
              <Text style={styles.assignDisabledHint}>
                No units available to assign right now.
              </Text>
            )}
          </>
        ) : hasCustody ? (
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
  primaryActionDisabled: {
    opacity: 0.5,
  },
  assignDisabledHint: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center",
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
