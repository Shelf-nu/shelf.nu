/**
 * BatchBlockers — renders blocker groups inside the batch drawer.
 *
 * Companion-app port of the web scanner's blocker UI
 * (webapp `components/scanner/drawer/blockers-factory.tsx`): each group of
 * ineligible scanned items gets a warning row with a one-tap "Remove" that
 * drops the affected items from the scan list. While any group is present
 * the drawer's submit button is disabled, so only clean batches ever reach
 * the all-or-nothing bulk endpoints.
 *
 * @see {@link file://./../../lib/batch-blockers.ts} rule definitions
 * @see {@link file://./batch-drawer.tsx} host component
 */
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { BlockerGroup } from "@/lib/batch-blockers";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

type Props = {
  /** Blocker groups from `computeBlockers` — render nothing when empty. */
  blockers: BlockerGroup[];
  /** Removes one group's items from the scan list. */
  onResolve: (group: BlockerGroup) => void;
  /** Removes every blocked item at once (shown with 2+ groups). */
  onResolveAll: () => void;
};

/**
 * Warning card listing why the batch cannot be submitted yet, with one-tap
 * fixes for each blocker group.
 *
 * @param props - Component props.
 * @param props.blockers - Blocker groups from `computeBlockers`; the card
 *   renders nothing when this is empty.
 * @param props.onResolve - Removes one group's items from the scan list.
 * @param props.onResolveAll - Removes every blocked item at once (shown with
 *   2+ groups).
 * @returns The blocker warning card, or `null` when there are no blockers.
 */
export function BatchBlockers({ blockers, onResolve, onResolveAll }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  if (blockers.length === 0) return null;

  return (
    <View style={styles.container} accessibilityRole="alert">
      {blockers.map((group) => (
        <View key={group.key} style={styles.row}>
          <Ionicons
            name="warning-outline"
            size={16}
            color={colors.warning}
            style={styles.icon}
          />
          <Text style={styles.message}>{group.message}</Text>
          <TouchableOpacity
            onPress={() => onResolve(group)}
            accessibilityLabel={`Remove ${group.qrIds.length} blocked item${
              group.qrIds.length > 1 ? "s" : ""
            } from the list`}
            accessibilityRole="button"
          >
            <Text style={styles.resolve}>
              Remove{group.qrIds.length > 1 ? ` ${group.qrIds.length}` : ""}
            </Text>
          </TouchableOpacity>
        </View>
      ))}

      {blockers.length > 1 && (
        <TouchableOpacity
          onPress={onResolveAll}
          style={styles.resolveAllBtn}
          accessibilityLabel="Remove all blocked items from the list"
          accessibilityRole="button"
        >
          <Text style={styles.resolveAll}>Remove all blocked items</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  container: {
    backgroundColor: colors.warningBg,
    borderRadius: borderRadius.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  icon: {
    marginTop: 1,
  },
  message: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foreground,
    lineHeight: 18,
  },
  resolve: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: colors.warning,
  },
  resolveAllBtn: {
    paddingVertical: spacing.xs,
    alignItems: "center",
  },
  resolveAll: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: colors.warning,
  },
}));
