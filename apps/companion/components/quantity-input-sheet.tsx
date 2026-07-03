/**
 * QuantityInputSheet — a page-sheet modal that asks "how many units?" for
 * quantity-custody actions on QUANTITY_TRACKED assets (assign N units to a
 * member / release N units from a holder).
 *
 * Follows the house selection-flow contract (TeamMemberPicker/LocationPicker):
 * `<Modal animationType="slide" presentationStyle="pageSheet">` + SafeAreaView
 * + header-with-close. The numeric input mirrors the asset-edit fields
 * (components/asset-edit/valuation-field.tsx): TextInput with a digits-only
 * clean, white background, gray300 1px border. React Native has no usable
 * prompt (Alert.prompt is iOS-only and unused in the app), hence this sheet.
 *
 * The sheet's explicit confirm button IS the confirmation step — callers must
 * not stack a second Alert on top of `onSubmit`.
 *
 * @see {@link file://../app/(tabs)/assets/[id].tsx} assign/release consumers
 * @see {@link file://./team-member-picker.tsx} the modal contract this mirrors
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
  /** Header title, e.g. "Assign Quantity". */
  title: string;
  /** Optional context line under the header, e.g. the custodian's name. */
  subtitle?: string;
  /** Upper bound for the quantity (inclusive). Submit is disabled above it. */
  max: number;
  /** Initial value when the sheet opens (clamped to [1, max]). Defaults to 1. */
  defaultValue?: number;
  /** Display unit echoed under the input (e.g. "pcs"); null/undefined hides it. */
  unitOfMeasure?: string | null;
  /** Confirm button label, e.g. "Assign" / "Release". */
  confirmLabel: string;
  /**
   * When true the confirm button uses the release-green styling — the
   * companion's established color for custody-release actions (see
   * quick-actions.tsx `primaryActionGreen`). Default is the primary black.
   */
  destructive?: boolean;
  /** Called with the validated quantity when the user confirms. */
  onSubmit: (quantity: number) => void;
  /** Called when the user dismisses the sheet without confirming. */
  onClose: () => void;
};

/**
 * Quantity prompt sheet for quantity-custody actions.
 *
 * Renders a number-pad TextInput flanked by -/+ stepper buttons, an echo of
 * the parsed value with its unit of measure, and a confirm button that stays
 * disabled while the value is empty, below 1, or above `max`.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet element.
 */
export function QuantityInputSheet({
  visible,
  title,
  subtitle,
  max,
  defaultValue,
  unitOfMeasure,
  confirmLabel,
  destructive,
  onSubmit,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  const [value, setValue] = useState("1");
  const inputRef = useRef<TextInput>(null);

  // Re-seed the input every time the sheet opens: each open targets a fresh
  // action (different member/holder), so stale values must not leak across.
  useEffect(() => {
    if (visible) {
      const seed = Math.min(Math.max(defaultValue ?? 1, 1), Math.max(max, 1));
      setValue(String(seed));
    }
  }, [visible, defaultValue, max]);

  const parsed = value ? parseInt(value, 10) : NaN;
  const hasValue = Number.isFinite(parsed);
  const overMax = hasValue && parsed > max;
  const isValid = hasValue && parsed >= 1 && parsed <= max;

  /** Step the current value by `delta`, clamped to [1, max]. */
  const step = (delta: number) => {
    const current = hasValue ? parsed : 0;
    const next = Math.min(Math.max(current + delta, 1), Math.max(max, 1));
    setValue(String(next));
  };

  const maxLabel = formatQuantity(max, unitOfMeasure) ?? String(max);
  const echo = hasValue ? formatQuantity(parsed, unitOfMeasure) : null;

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
          <Text style={styles.headerTitle}>{title}</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityLabel={`Close ${title.toLowerCase()}`}
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

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
                // Digits only — quantities are positive integers
                // (valuation-field.tsx pattern, minus the decimal point).
                setValue(text.replace(/[^0-9]/g, ""));
              }}
              placeholder={`Max: ${max}`}
              placeholderTextColor={colors.placeholderText}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel={`Quantity, maximum ${maxLabel}`}
            />
            <TouchableOpacity
              style={[
                styles.stepButton,
                hasValue && parsed >= max && styles.stepButtonDisabled,
              ]}
              onPress={() => step(1)}
              disabled={hasValue && parsed >= max}
              activeOpacity={0.7}
              accessibilityLabel="Increase quantity"
              accessibilityRole="button"
              accessibilityState={{ disabled: hasValue && parsed >= max }}
            >
              <Ionicons name="add" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Echo / bounds hint under the input */}
          {overMax ? (
            <Text style={styles.errorHint}>Only {maxLabel} available.</Text>
          ) : (
            <Text style={styles.echoHint}>
              {echo ? `${echo} of ${maxLabel}` : `Up to ${maxLabel}`}
            </Text>
          )}

          {/* Confirm */}
          <TouchableOpacity
            style={[
              destructive ? styles.confirmRelease : styles.confirmPrimary,
              !isValid && styles.confirmDisabled,
            ]}
            onPress={() => {
              if (isValid) onSubmit(parsed);
            }}
            disabled={!isValid}
            activeOpacity={0.7}
            accessibilityLabel={`${confirmLabel} ${echo ?? "quantity"}`}
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
  errorHint: {
    fontSize: fontSize.sm,
    color: colors.error,
    textAlign: "center",
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
  confirmRelease: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.available,
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
}));
