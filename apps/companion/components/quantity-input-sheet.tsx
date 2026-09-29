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
 * Confirming does not close the sheet. The caller sends the request with the
 * sheet still open and passes `isSubmitting` while it runs; the inputs lock,
 * the confirm button shows a spinner, and the sheet cannot be dismissed until
 * the request settles. It closes only once the server accepts the change, so
 * a refusal keeps the entered numbers.
 *
 * @see {@link file://../app/(tabs)/assets/[id].tsx} assign/release consumers
 * @see {@link file://../app/(tabs)/bookings/[id].tsx} the check-out queue consumer
 * @see {@link file://../app/(tabs)/bookings/add-assets.tsx} the reserve-model consumer
 * @see {@link file://./team-member-picker.tsx} the modal contract this mirrors
 */
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
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
  /**
   * Lower bound for the quantity (inclusive). Defaults to 1, which is the
   * floor for a plain count. Raise it when part of the quantity is already
   * committed and cannot be taken back — editing a booking's model
   * reservation cannot drop below the units already assigned to the booking.
   */
  min?: number;
  /** Initial value when the sheet opens (clamped to [min, max]). Defaults to `min`. */
  defaultValue?: number;
  /** Display unit echoed under the input (e.g. "pcs"); null/undefined hides it. */
  unitOfMeasure?: string | null;
  /**
   * Optional second numeric field rendered under the primary one. The ONE_WAY
   * custody release uses it to ask how many of the released units were used
   * up. Its value is clamped to the primary quantity, so it can never
   * over-claim.
   */
  secondary?: {
    /** Field label, e.g. "Of those, how many were used up?". */
    label: string;
    /** Initial value when the sheet opens (clamped to [0, primary]). */
    defaultValue?: number;
  };
  /** Confirm button label, e.g. "Assign" / "Release". */
  confirmLabel: string;
  /**
   * When true the confirm button uses the release-green styling — the
   * companion's established color for custody-release actions (see
   * quick-actions.tsx `primaryActionGreen`). Default is the primary black.
   */
  destructive?: boolean;
  /**
   * True while the confirmed action's request runs. Locks the inputs, shows a
   * spinner on the confirm button, and blocks dismissal until the request
   * settles.
   */
  isSubmitting?: boolean;
  /**
   * Called with the validated quantity when the user confirms, plus the
   * secondary value when a `secondary` field is configured. The caller
   * performs the request with the sheet still open and closes it only once
   * the server accepts the change.
   */
  onSubmit: (quantity: number, secondaryValue?: number) => void;
  /**
   * Called when the user dismisses the sheet without confirming. Never called
   * while `isSubmitting`.
   */
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
  min = 1,
  defaultValue,
  unitOfMeasure,
  secondary,
  confirmLabel,
  destructive,
  isSubmitting = false,
  onSubmit,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  const [value, setValue] = useState("1");
  const [secondaryValue, setSecondaryValue] = useState("0");
  const inputRef = useRef<TextInput>(null);

  // The secondary field's presence and seed are read out as primitives so the
  // re-seed effect below can depend on THEM rather than on the `secondary`
  // object. Callers build that object inline, giving it a fresh identity on
  // every parent render — as a dependency it would turn "re-seed on open" into
  // "re-seed on every parent render", silently discarding a split the operator
  // had already typed.
  const hasSecondaryField = secondary != null;
  const secondaryDefaultValue = secondary?.defaultValue;

  // Re-seed the inputs every time the sheet opens: each open targets a fresh
  // action (different member/holder), so stale values must not leak across.
  useEffect(() => {
    if (visible) {
      const seed = Math.min(
        Math.max(defaultValue ?? min, min),
        Math.max(max, min)
      );
      setValue(String(seed));
      if (hasSecondaryField) {
        // Clamp the secondary seed to the primary seed — the two fields move
        // together and the secondary can never exceed the units being released.
        setSecondaryValue(
          String(Math.min(Math.max(secondaryDefaultValue ?? 0, 0), seed))
        );
      }
    }
  }, [
    visible,
    defaultValue,
    max,
    min,
    hasSecondaryField,
    secondaryDefaultValue,
  ]);

  const parsed = value ? parseInt(value, 10) : NaN;
  const hasValue = Number.isFinite(parsed);
  const overMax = hasValue && parsed > max;
  const underMin = hasValue && parsed < min;
  const isValid = hasValue && parsed >= min && parsed <= max;

  const parsedSecondary = secondaryValue ? parseInt(secondaryValue, 10) : NaN;
  const hasSecondary = Number.isFinite(parsedSecondary);
  // With no secondary field the sheet behaves exactly as it always has.
  const isSecondaryValid =
    !secondary ||
    (hasSecondary &&
      parsedSecondary >= 0 &&
      hasValue &&
      parsedSecondary <= parsed);
  const canConfirm = isValid && isSecondaryValid && !isSubmitting;
  const canDecrease = !isSubmitting && hasValue && parsed > min;
  const canIncrease = !isSubmitting && !(hasValue && parsed >= max);

  /**
   * Pull the secondary value down when the primary quantity drops below it.
   *
   * Both fields seed to the same number for a consumable release, so without
   * this a single tap of the minus button leaves the secondary above the
   * primary and disables Confirm until the operator edits the second field by
   * hand. Clamps DOWNWARD only, so someone who deliberately typed a smaller
   * used-up count keeps it when they raise the primary again. The webapp's
   * counterpart already does this in its reducer.
   */
  const clampSecondaryTo = (nextPrimary: number) => {
    if (!hasSecondaryField) return;
    setSecondaryValue((prev) => {
      const prevParsed = prev ? parseInt(prev, 10) : NaN;
      if (!Number.isFinite(prevParsed) || prevParsed <= nextPrimary)
        return prev;
      return String(nextPrimary);
    });
  };

  /** Step the current value by `delta`, clamped to [min, max]. */
  const step = (delta: number) => {
    const current = hasValue ? parsed : 0;
    const next = Math.min(Math.max(current + delta, min), Math.max(max, min));
    setValue(String(next));
    clampSecondaryTo(next);
  };

  const maxLabel = formatQuantity(max, unitOfMeasure) ?? String(max);
  const minLabel = formatQuantity(min, unitOfMeasure) ?? String(min);
  const echo = hasValue ? formatQuantity(parsed, unitOfMeasure) : null;

  /**
   * Every dismissal path goes through here. A request in flight decides
   * whether the sheet closes, and a refusal must find the entered numbers
   * still on screen, so dismissal waits for it to settle.
   */
  const requestClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={requestClose}
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
            onPress={requestClose}
            disabled={isSubmitting}
            style={[styles.closeButton, isSubmitting && styles.dismissDisabled]}
            accessibilityLabel={`Close ${title.toLowerCase()}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
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
                !canDecrease && styles.stepButtonDisabled,
              ]}
              onPress={() => step(-1)}
              disabled={!canDecrease}
              activeOpacity={0.7}
              accessibilityLabel="Decrease quantity"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canDecrease }}
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
                const cleaned = text.replace(/[^0-9]/g, "");
                setValue(cleaned);
                // Guard on finite: clearing the field must not write "NaN"
                // into the secondary input. An empty primary already blocks
                // Confirm via `isValid`.
                const next = cleaned ? parseInt(cleaned, 10) : NaN;
                if (Number.isFinite(next)) clampSecondaryTo(next);
              }}
              placeholder={min > 1 ? `${min}–${max}` : `Max: ${max}`}
              placeholderTextColor={colors.placeholderText}
              editable={!isSubmitting}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel={
                min > 1
                  ? `Quantity, between ${minLabel} and ${maxLabel}`
                  : `Quantity, maximum ${maxLabel}`
              }
            />
            <TouchableOpacity
              style={[
                styles.stepButton,
                !canIncrease && styles.stepButtonDisabled,
              ]}
              onPress={() => step(1)}
              disabled={!canIncrease}
              activeOpacity={0.7}
              accessibilityLabel="Increase quantity"
              accessibilityRole="button"
              accessibilityState={{ disabled: !canIncrease }}
            >
              <Ionicons name="add" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Echo / bounds hint under the input */}
          {overMax ? (
            <Text style={styles.errorHint}>Only {maxLabel} available.</Text>
          ) : underMin ? (
            <Text style={styles.errorHint}>At least {minLabel}.</Text>
          ) : (
            <Text style={styles.echoHint}>
              {echo ? `${echo} of ${maxLabel}` : `Up to ${maxLabel}`}
            </Text>
          )}

          {/* Optional second field, e.g. how many released units were used up */}
          {secondary ? (
            <View style={styles.secondaryBlock}>
              <Text style={styles.secondaryLabel}>{secondary.label}</Text>
              <TextInput
                style={styles.input}
                value={secondaryValue}
                onChangeText={(text) => {
                  setSecondaryValue(text.replace(/[^0-9]/g, ""));
                }}
                placeholder="0"
                placeholderTextColor={colors.placeholderText}
                editable={!isSubmitting}
                keyboardType="number-pad"
                returnKeyType="done"
                accessibilityLabel={secondary.label}
              />
              {!isSecondaryValid ? (
                <Text style={styles.errorHint}>
                  Cannot exceed the {hasValue ? parsed : 0} being released.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Confirm */}
          <TouchableOpacity
            style={[
              destructive ? styles.confirmRelease : styles.confirmPrimary,
              !canConfirm && styles.confirmDisabled,
            ]}
            onPress={() => {
              if (canConfirm) {
                onSubmit(parsed, secondary ? parsedSecondary : undefined);
              }
            }}
            disabled={!canConfirm}
            activeOpacity={0.7}
            accessibilityLabel={`${confirmLabel} ${echo ?? "quantity"}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm, busy: isSubmitting }}
          >
            {isSubmitting ? (
              <ActivityIndicator
                size="small"
                color={colors.primaryForeground}
              />
            ) : (
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            )}
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
  dismissDisabled: {
    opacity: 0.5,
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
  secondaryBlock: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  secondaryLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
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
