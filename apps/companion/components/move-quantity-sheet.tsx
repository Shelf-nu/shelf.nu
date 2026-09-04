/**
 * MoveQuantitySheet — a page-sheet modal that confirms a location move for a
 * QUANTITY_TRACKED asset with a per-placement quantity. Mobile twin of the
 * web's asset-overview "Update location" dialog
 * (apps/webapp/app/routes/_layout+/assets.$assetId.overview.update-location.tsx):
 * a "quantity to place at this location" input bounded by the asset's total
 * pool, the unplaced-pool hint, and the multi-placement collapse warning.
 *
 * The move itself is a pivot REPLACE on the server: every placement is
 * cleared and one new row is created at the target location. Units not
 * placed stay in the unplaced pool. That is why `placementCount > 1` shows
 * a warning rather than merging placements.
 *
 * Follows the house selection-flow contract (AdjustQuantitySheet /
 * QuantityInputSheet): `<Modal animationType="slide"
 * presentationStyle="pageSheet">` + SafeAreaView + header-with-close,
 * digits-only numeric input flanked by -/+ steppers.
 *
 * INDIVIDUAL assets never see this sheet — the caller keeps the plain
 * confirm alert for them.
 *
 * @see {@link file://../app/(tabs)/assets/[id].tsx} the consumer
 * @see {@link file://./adjust-quantity-sheet.tsx} the modal contract this mirrors
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, Modal, TextInput, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { formatQuantity } from "@/lib/quantity-format";

type Props = {
  /** Whether the sheet is shown. */
  visible: boolean;
  /** Name of the target location the user picked. */
  locationName: string;
  /** The asset's total pool (`Asset.quantity`) — the input's upper bound. */
  totalQuantity: number;
  /** Display unit echoed in copy (e.g. "pcs"); null/undefined falls back to "units". */
  unitOfMeasure?: string | null;
  /**
   * Pre-fill for the input: the units currently placed at the primary
   * location, or the full pool when the asset is unplaced (web dialog
   * parity).
   */
  initialQuantity: number;
  /**
   * Number of placements the asset currently has. > 1 renders the collapse
   * warning, because confirming replaces every placement with the single
   * new one.
   */
  placementCount: number;
  /** Called with the confirmed per-placement quantity. */
  onConfirm: (quantity: number) => void;
  /** Called when the user dismisses the sheet without confirming. */
  onClose: () => void;
};

/**
 * Location-move prompt sheet for QUANTITY_TRACKED assets.
 *
 * Renders the target location, a number-pad TextInput flanked by -/+ stepper
 * buttons bounded to `1..totalQuantity`, the unplaced-pool hint when moving
 * fewer units than the pool, the multi-placement collapse warning, and a
 * Move / Cancel pair.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet element.
 */
export function MoveQuantitySheet({
  visible,
  locationName,
  totalQuantity,
  unitOfMeasure,
  initialQuantity,
  placementCount,
  onConfirm,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  const [value, setValue] = useState(String(initialQuantity));
  const inputRef = useRef<TextInput>(null);

  // Re-seed the input every time the sheet opens: each open is a fresh move
  // (possibly of a different asset), so stale values must not leak across.
  useEffect(() => {
    if (visible) {
      setValue(String(initialQuantity));
    }
  }, [visible, initialQuantity]);

  const parsed = value ? parseInt(value, 10) : NaN;
  const hasValue = Number.isFinite(parsed);
  const isValid = hasValue && parsed >= 1 && parsed <= totalQuantity;

  const unitLabel = unitOfMeasure || "units";
  const totalLabel =
    formatQuantity(totalQuantity, unitOfMeasure) ?? String(totalQuantity);
  const echo = hasValue ? formatQuantity(parsed, unitOfMeasure) : null;
  const isPartial = hasValue && parsed < totalQuantity;

  /** Step the current value by `delta`, clamped to `1..totalQuantity`. */
  const step = (delta: number) => {
    const current = hasValue ? parsed : 0;
    const next = Math.min(Math.max(current + delta, 1), totalQuantity);
    setValue(String(next));
  };

  const submit = () => {
    if (!isValid) return;
    onConfirm(parsed);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      // why: imperative focus once the sheet has actually presented — an
      // autoFocus prop fires before the modal animation and misses the
      // keyboard (and jsx-a11y/no-autofocus flags it).
      onShow={() => inputRef.current?.focus()}
    >
      <SafeAreaView style={styles.container} accessibilityViewIsModal={true}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Update Location</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityLabel="Close update location"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {/* Target location */}
          <View style={styles.locationRow}>
            <Ionicons
              name="location-outline"
              size={18}
              color={colors.foregroundSecondary}
            />
            <Text style={styles.locationName} numberOfLines={1}>
              {locationName}
            </Text>
          </View>

          <Text style={styles.subtitle}>
            Quantity to place at this location:
          </Text>

          {/* Quantity row: [-] [input] [+] */}
          <View style={styles.quantityRow}>
            <TouchableOpacity
              style={[
                styles.stepButton,
                (!hasValue || parsed <= 1) && styles.stepButtonDisabled,
              ]}
              onPress={() => step(-1)}
              disabled={!hasValue || parsed <= 1}
              activeOpacity={0.7}
              accessibilityLabel="Decrease quantity"
              accessibilityRole="button"
              accessibilityState={{ disabled: !hasValue || parsed <= 1 }}
            >
              <Ionicons name="remove" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={value}
              onChangeText={(text) => {
                // Digits only — placement quantities are positive integers.
                // The pool bound is enforced live so the input can never
                // read more than the asset owns (web dialog parity).
                const digits = text.replace(/[^0-9]/g, "");
                if (!digits) {
                  setValue("");
                  return;
                }
                const capped = Math.min(parseInt(digits, 10), totalQuantity);
                setValue(String(capped));
              }}
              placeholder="Enter quantity"
              placeholderTextColor={colors.placeholderText}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel="Quantity to place at this location"
            />
            <TouchableOpacity
              style={[
                styles.stepButton,
                hasValue &&
                  parsed >= totalQuantity &&
                  styles.stepButtonDisabled,
              ]}
              onPress={() => step(1)}
              disabled={hasValue && parsed >= totalQuantity}
              activeOpacity={0.7}
              accessibilityLabel="Increase quantity"
              accessibilityRole="button"
              accessibilityState={{
                disabled: hasValue && parsed >= totalQuantity,
              }}
            >
              <Ionicons name="add" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Echo under the input */}
          <Text style={styles.echoHint}>
            {echo ?? `Enter a quantity`} of {totalLabel}
          </Text>

          {/* Unplaced-pool hint — only when moving fewer units than the pool */}
          {isPartial ? (
            <Text style={styles.poolHint}>
              The other {totalQuantity - parsed} {unitLabel} stay in the
              unplaced pool, not at the current location.
            </Text>
          ) : null}

          {/* Multi-placement collapse warning */}
          {placementCount > 1 ? (
            <View style={styles.warningBox}>
              <Ionicons
                name="warning-outline"
                size={18}
                color={colors.warningText}
              />
              <Text style={styles.warningText}>
                This asset is placed at {placementCount} locations. Moving will
                replace all placements with a single placement at {locationName}
                .
              </Text>
            </View>
          ) : null}

          {/* Confirm */}
          <TouchableOpacity
            style={[styles.confirmPrimary, !isValid && styles.confirmDisabled]}
            onPress={submit}
            disabled={!isValid}
            activeOpacity={0.7}
            accessibilityLabel={`Move ${echo ?? "quantity"} to ${locationName}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Ionicons
              name="location"
              size={20}
              color={colors.primaryForeground}
            />
            <Text style={styles.confirmText}>Move</Text>
          </TouchableOpacity>

          {/* Cancel */}
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={onClose}
            activeOpacity={0.7}
            accessibilityLabel="Cancel move"
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
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
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadows.sm,
  },
  locationName: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  subtitle: {
    fontSize: fontSize.lg,
    color: colors.foregroundSecondary,
    lineHeight: 22,
  },
  quantityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepButton: {
    width: 44,
    height: 44,
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
  input: {
    flex: 1,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.lg,
    color: colors.foreground,
    textAlign: "center",
    ...shadows.sm,
  },
  echoHint: {
    fontSize: fontSize.sm,
    color: colors.muted,
    textAlign: "center",
  },
  poolHint: {
    fontSize: fontSize.sm,
    color: colors.foregroundSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
  warningBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.warningBg,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  warningText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.warningText,
    lineHeight: 18,
  },
  confirmPrimary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    marginTop: spacing.sm,
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
  cancelButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
    ...shadows.sm,
  },
  cancelText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
}));
