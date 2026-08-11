/**
 * AdjustQuantitySheet — a page-sheet modal for adjusting total stock of a
 * QUANTITY_TRACKED asset. Mobile twin of the web's QuickAdjustDialog
 * (apps/webapp/app/components/assets/quick-adjust-dialog.tsx): a quantity,
 * an optional note, and two actions — "Add" (restock) and "Remove" (loss).
 * The direction→category mapping (add→RESTOCK, subtract→LOSS) matches the
 * web dialog and is applied by the caller's submit handler.
 *
 * Follows the house selection-flow contract (QuantityInputSheet):
 * `<Modal animationType="slide" presentationStyle="pageSheet">` + SafeAreaView
 * + header-with-close, digits-only numeric input flanked by -/+ steppers.
 *
 * Removing is capped client-side at `availableQuantity` (total minus units
 * out in custody/bookings) with the web dialog's error copy; the server
 * enforces the real cap either way. Adding has no upper bound.
 *
 * @see {@link file://../app/(tabs)/assets/[id].tsx} the consumer
 * @see {@link file://./quantity-input-sheet.tsx} the modal contract this mirrors
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
  /**
   * Units removable right now (total minus in-custody/checked-out). Removing
   * more is blocked with an inline error; adding is unbounded.
   */
  availableQuantity: number;
  /** Display unit echoed in copy (e.g. "pcs"); null/undefined falls back to "units". */
  unitOfMeasure?: string | null;
  /**
   * Called with the confirmed adjustment. `direction` maps to the
   * ConsumptionLog category exactly like the web dialog: add→RESTOCK,
   * subtract→LOSS.
   */
  onSubmit: (args: {
    direction: "add" | "subtract";
    quantity: number;
    note?: string;
  }) => void;
  /** Called when the user dismisses the sheet without confirming. */
  onClose: () => void;
};

/**
 * Stock-adjustment prompt sheet for QUANTITY_TRACKED assets.
 *
 * Renders a number-pad TextInput flanked by -/+ stepper buttons, an optional
 * note field, and Add / Remove actions. Add stays enabled for any positive
 * quantity; Remove is blocked above `availableQuantity` with the web
 * dialog's "the rest is in custody" explanation.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet element.
 */
export function AdjustQuantitySheet({
  visible,
  availableQuantity,
  unitOfMeasure,
  onSubmit,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  const [value, setValue] = useState("1");
  const [note, setNote] = useState("");
  /** Set when the user attempts a Remove above the available cap. */
  const [removeError, setRemoveError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  // Re-seed the inputs every time the sheet opens: each open is a fresh
  // adjustment, so stale values must not leak across.
  useEffect(() => {
    if (visible) {
      setValue("1");
      setNote("");
      setRemoveError(null);
    }
  }, [visible]);

  const parsed = value ? parseInt(value, 10) : NaN;
  const hasValue = Number.isFinite(parsed);
  const isValid = hasValue && parsed >= 1;

  const unitLabel = unitOfMeasure || "units";
  const echo = hasValue ? formatQuantity(parsed, unitOfMeasure) : null;
  const availableLabel =
    formatQuantity(availableQuantity, unitOfMeasure) ??
    String(availableQuantity);

  /** Step the current value by `delta`, clamped to a minimum of 1. */
  const step = (delta: number) => {
    const current = hasValue ? parsed : 0;
    const next = Math.max(current + delta, 1);
    setValue(String(next));
    setRemoveError(null);
  };

  const submit = (direction: "add" | "subtract") => {
    if (!isValid) return;

    // Client-side guard mirroring the web dialog: can't remove more than
    // available (the server enforces the row-locked real cap regardless).
    if (direction === "subtract" && parsed > availableQuantity) {
      setRemoveError(
        `Cannot remove ${parsed} ${unitLabel}. Only ${availableLabel} available (the rest is in custody).`
      );
      return;
    }

    setRemoveError(null);
    onSubmit({
      direction,
      quantity: parsed,
      note: note.trim() ? note.trim() : undefined,
    });
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
          <Text style={styles.headerTitle}>Adjust Quantity</Text>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            accessibilityLabel="Close adjust quantity"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.subtitle}>
            Add or remove stock for this asset. Enter the number of {unitLabel}{" "}
            to adjust.
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
                // Digits only — quantities are positive integers
                // (valuation-field.tsx pattern, minus the decimal point).
                setValue(text.replace(/[^0-9]/g, ""));
                setRemoveError(null);
              }}
              placeholder="Enter quantity"
              placeholderTextColor={colors.placeholderText}
              keyboardType="number-pad"
              returnKeyType="done"
              accessibilityLabel="Quantity to adjust"
            />
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => step(1)}
              activeOpacity={0.7}
              accessibilityLabel="Increase quantity"
              accessibilityRole="button"
            >
              <Ionicons name="add" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Echo / error under the input */}
          {removeError ? (
            <Text style={styles.errorHint}>{removeError}</Text>
          ) : (
            <Text style={styles.echoHint}>
              {echo ?? "Enter a quantity"} · {availableLabel} removable
            </Text>
          )}

          {/* Optional note */}
          <View style={styles.noteBlock}>
            <Text style={styles.noteLabel}>Note (optional)</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="Reason for adjustment..."
              placeholderTextColor={colors.placeholderText}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              accessibilityLabel="Reason for adjustment"
            />
          </View>

          {/* Add (restock) */}
          <TouchableOpacity
            style={[styles.confirmPrimary, !isValid && styles.confirmDisabled]}
            onPress={() => submit("add")}
            disabled={!isValid}
            activeOpacity={0.7}
            accessibilityLabel={`Add ${echo ?? "quantity"} to stock`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Ionicons name="add" size={20} color={colors.primaryForeground} />
            <Text style={styles.confirmText}>Add</Text>
          </TouchableOpacity>

          {/* Remove (loss) */}
          <TouchableOpacity
            style={[styles.removeButton, !isValid && styles.confirmDisabled]}
            onPress={() => submit("subtract")}
            disabled={!isValid}
            activeOpacity={0.7}
            accessibilityLabel={`Remove ${echo ?? "quantity"} from stock`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Ionicons name="remove" size={20} color={colors.foreground} />
            <Text style={styles.removeText}>Remove</Text>
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
  noteBlock: {
    gap: spacing.xs,
  },
  noteLabel: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  noteInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.lg,
    color: colors.foreground,
    minHeight: 76,
    ...shadows.sm,
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
  removeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.lg,
    paddingVertical: 14,
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
  removeText: {
    color: colors.foreground,
    fontSize: fontSize.lg,
    fontWeight: "600",
  },
}));
