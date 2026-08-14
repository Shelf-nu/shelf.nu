/**
 * CheckinDispositionSheet — asks "how are these coming back?" for a
 * QUANTITY_TRACKED asset. The mobile twin of the web check-in drawer: per
 * asset, the operator splits the still-checked-out units across
 * returned / consumed / lost / damaged.
 *
 * Design goal is maximum human clarity (not a bare form):
 *  - It opens as a plain question, with the common case pre-answered: the
 *    primary bucket (returned for returnable assets, consumed for consumables)
 *    defaults to all remaining, so "everything came back" is a one-tap confirm.
 *  - A colour-coded split bar shows, at a glance, how the units are being
 *    accounted for (green = returned/consumed, amber = lost, red = damaged,
 *    grey = still checked out).
 *  - A live status line ("All 6 checked in" / "4 of 6 · 2 stay checked out")
 *    means the operator can never submit a nonsensical split, and always knows
 *    what the confirm will do.
 *
 * The fields shown depend on the asset's consumption type:
 *  - TWO_WAY (returnable): Returned, Lost, Damaged
 *  - ONE_WAY (consumable): Consumed, Lost, Damaged
 *
 * Mirrors {@link file://./quantity-input-sheet.tsx}'s modal contract
 * (`<Modal presentationStyle="pageSheet">` + SafeAreaView + header-with-close).
 */
import { useEffect, useState } from "react";
import { View, Text, Modal, TextInput, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { ConsumptionType } from "@/lib/api";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { formatQuantity } from "@/lib/quantity-format";

/** How the checked-out units were reconciled. Sum must be in [1, remaining]. */
export type CheckinDispositionValue = {
  returned: number;
  consumed: number;
  lost: number;
  damaged: number;
};

type FieldKey = keyof CheckinDispositionValue;

/**
 * Disposition colours, shared with the confirm-flow split bar. Fixed hues (not
 * theme tokens) so the green/amber/red mapping reads the same on every device:
 * green = the unit is fine, amber = lost, red = damaged.
 */
const DISPOSITION_COLOR: Record<FieldKey, string> = {
  returned: "#639922",
  consumed: "#639922",
  lost: "#BA7517",
  damaged: "#E24B4A",
};

type Props = {
  visible: boolean;
  /** Asset title shown under the header. */
  assetTitle: string;
  /** Units still checked out on this booking (the max total). */
  remaining: number;
  /** Decides the primary bucket: consume-all for ONE_WAY, return-all otherwise. */
  consumptionType?: ConsumptionType | null;
  /** Display unit echoed in the totals (e.g. "pcs"). */
  unitOfMeasure?: string | null;
  /**
   * Whether this is the final asset in the check-in queue. The last asset's
   * button submits ("Check in N"); earlier ones advance ("Next").
   */
  isLast: boolean;
  onSubmit: (value: CheckinDispositionValue) => void;
  onClose: () => void;
};

const ZERO: CheckinDispositionValue = {
  returned: 0,
  consumed: 0,
  lost: 0,
  damaged: 0,
};

/**
 * Disposition prompt sheet for a quantity-tracked check-in.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet element.
 */
export function CheckinDispositionSheet({
  visible,
  assetTitle,
  remaining,
  consumptionType,
  unitOfMeasure,
  isLast,
  onSubmit,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  // The "good" bucket is consume for consumables, return otherwise.
  const isConsumable = consumptionType === "ONE_WAY";
  const primaryKey: FieldKey = isConsumable ? "consumed" : "returned";
  const primaryLabel = isConsumable ? "Consumed" : "Returned";

  const [counts, setCounts] = useState<CheckinDispositionValue>(ZERO);

  // Re-seed each open: default the primary bucket to all remaining so "checked
  // everything back in" is one tap. Each open targets a fresh asset.
  useEffect(() => {
    if (visible) {
      setCounts({ ...ZERO, [primaryKey]: Math.max(remaining, 0) });
    }
    // why: primaryKey derives from consumptionType, already in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, remaining, consumptionType]);

  const total =
    counts.returned + counts.consumed + counts.lost + counts.damaged;
  const remainder = Math.max(remaining - total, 0);
  const isValid = total >= 1 && total <= remaining;

  /** Set one bucket, clamped so the running total can never exceed `remaining`. */
  const setField = (key: FieldKey, next: number) => {
    setCounts((prev) => {
      const others =
        prev.returned + prev.consumed + prev.lost + prev.damaged - prev[key];
      const capped = Math.min(
        Math.max(next, 0),
        Math.max(remaining - others, 0)
      );
      return { ...prev, [key]: capped };
    });
  };

  const remainingLabel =
    formatQuantity(remaining, unitOfMeasure) ?? String(remaining);
  const totalLabel = formatQuantity(total, unitOfMeasure) ?? String(total);
  const question = isConsumable
    ? `How were these ${remainingLabel} used?`
    : "How are they coming back?";
  const confirmLabel = isLast ? `Check in ${totalLabel}` : "Next";

  /** One labelled stepper row (dot + label + -/value/+), capped to remaining. */
  const renderStepperRow = (key: FieldKey, label: string) => {
    const cur = counts[key];
    const canInc = total < remaining;
    return (
      <View style={styles.fieldRow}>
        <View style={styles.fieldLabelWrap}>
          <View
            style={[styles.dot, { backgroundColor: DISPOSITION_COLOR[key] }]}
          />
          <Text style={styles.fieldLabel}>{label}</Text>
        </View>
        <View style={styles.stepperGroup}>
          <TouchableOpacity
            style={[styles.stepButton, cur <= 0 && styles.stepButtonDisabled]}
            onPress={() => setField(key, cur - 1)}
            disabled={cur <= 0}
            activeOpacity={0.7}
            accessibilityLabel={`Decrease ${label.toLowerCase()}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: cur <= 0 }}
          >
            <Ionicons name="remove" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TextInput
            style={styles.fieldInput}
            value={String(cur)}
            onChangeText={(t) =>
              setField(key, parseInt(t.replace(/[^0-9]/g, ""), 10) || 0)
            }
            keyboardType="number-pad"
            returnKeyType="done"
            accessibilityLabel={`${label} quantity`}
          />
          <TouchableOpacity
            style={[styles.stepButton, !canInc && styles.stepButtonDisabled]}
            onPress={() => setField(key, cur + 1)}
            disabled={!canInc}
            activeOpacity={0.7}
            accessibilityLabel={`Increase ${label.toLowerCase()}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canInc }}
          >
            <Ionicons name="add" size={20} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Split-bar segments: only render non-zero buckets so thin slivers don't
  // clutter, plus a grey tail for units staying checked out.
  const segments: { key: string; value: number; color: string }[] = [
    {
      key: primaryKey,
      value: counts[primaryKey],
      color: DISPOSITION_COLOR[primaryKey],
    },
    { key: "lost", value: counts.lost, color: DISPOSITION_COLOR.lost },
    { key: "damaged", value: counts.damaged, color: DISPOSITION_COLOR.damaged },
    { key: "remainder", value: remainder, color: colors.gray300 },
  ].filter((s) => s.value > 0);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} accessibilityViewIsModal={true}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Check in</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityLabel="Close check-in"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.context}>
            <Text style={styles.contextStrong}>{remainingLabel}</Text> of{" "}
            {assetTitle} still to check in.
          </Text>
          <Text style={styles.question}>{question}</Text>

          {/* Colour-coded split of the checked-out units. */}
          <View
            style={styles.splitBar}
            accessibilityLabel={`${totalLabel} of ${remainingLabel} being checked in`}
          >
            {segments.map((s) => (
              <View
                key={s.key}
                style={[
                  styles.splitSegment,
                  { flexGrow: s.value, backgroundColor: s.color },
                ]}
              >
                {s.key !== "remainder" ? (
                  <Text style={styles.splitSegmentText}>{s.value}</Text>
                ) : null}
              </View>
            ))}
          </View>

          {renderStepperRow(primaryKey, primaryLabel)}

          <View style={styles.problemSection}>
            <Text style={styles.problemCaption}>Anything wrong with some?</Text>
            {renderStepperRow("lost", "Lost")}
            {renderStepperRow("damaged", "Damaged")}
          </View>

          {/* Live status — the operator always knows what confirm will do. */}
          <View
            style={[
              styles.statusPill,
              total === remaining
                ? styles.statusComplete
                : styles.statusPartial,
            ]}
          >
            <Ionicons
              name={
                total === remaining ? "checkmark-circle" : "ellipse-outline"
              }
              size={16}
              color={
                total === remaining ? "#3B6D11" : colors.foregroundSecondary
              }
            />
            <Text
              style={[
                styles.statusText,
                total === remaining
                  ? styles.statusTextComplete
                  : styles.statusTextPartial,
              ]}
            >
              {total === remaining
                ? `All ${remainingLabel} checked in`
                : `${totalLabel} of ${remainingLabel} · ${
                    formatQuantity(remainder, unitOfMeasure) ?? remainder
                  } still to check in`}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.confirmPrimary, !isValid && styles.confirmDisabled]}
            onPress={() => {
              if (isValid) onSubmit(counts);
            }}
            disabled={!isValid}
            activeOpacity={0.7}
            accessibilityLabel={confirmLabel}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: fontSize.xl,
    fontWeight: "600",
    color: colors.foreground,
  },
  closeButton: {
    padding: spacing.xs,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.md,
  },
  context: {
    fontSize: fontSize.base,
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },
  contextStrong: {
    color: colors.foreground,
    fontWeight: "600",
  },
  question: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  splitBar: {
    flexDirection: "row",
    height: 30,
    borderRadius: borderRadius.sm,
    overflow: "hidden",
    backgroundColor: colors.gray300,
  },
  splitSegment: {
    flexBasis: 0,
    minWidth: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  splitSegmentText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: "600",
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  fieldLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexShrink: 1,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  fieldLabel: {
    fontSize: fontSize.base,
    fontWeight: "500",
    color: colors.foreground,
  },
  stepperGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    justifyContent: "center",
    alignItems: "center",
    ...shadows.sm,
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  fieldInput: {
    width: 56,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: fontSize.lg,
    color: colors.foreground,
    textAlign: "center",
    ...shadows.sm,
  },
  problemSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  problemCaption: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderRadius: borderRadius.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statusComplete: {
    backgroundColor: "#EAF3DE",
  },
  statusPartial: {
    backgroundColor: colors.backgroundSecondary,
  },
  statusText: {
    fontSize: fontSize.sm,
    flexShrink: 1,
  },
  statusTextComplete: {
    color: "#3B6D11",
    fontWeight: "500",
  },
  statusTextPartial: {
    color: colors.foregroundSecondary,
  },
  confirmPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    marginTop: spacing.xs,
    gap: spacing.sm,
    ...shadows.sm,
  },
  confirmDisabled: {
    opacity: 0.5,
  },
  confirmText: {
    color: colors.primaryForeground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
}));
