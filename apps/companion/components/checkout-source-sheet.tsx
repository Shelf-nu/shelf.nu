/**
 * CheckoutSourceSheet — "Where do the units come from?" at booking check-out.
 *
 * Mobile twin of the web's check-out source dialog: for every pool on the
 * booking that is kept at two or more locations and has not gone out yet, one
 * "From location" picker, pre-selected with the server's own default. The
 * answers go out as `sourceLocations` on the check-out request; units used up
 * on the booking later come off the picked location at check-in.
 *
 * Follows the house selection-flow contract (QuantityInputSheet):
 * `<Modal animationType="slide" presentationStyle="pageSheet">` + SafeAreaView
 * + header-with-close. Confirm does not close the sheet: the caller sends the
 * request with it open and closes it once the server accepts, so a refusal
 * keeps every answer on screen.
 *
 * @see {@link file://../app/(tabs)/bookings/[id].tsx} the consumer
 * @see {@link file://../lib/custody-source-options.ts} the rows and defaults
 */
import { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { formatQuantity } from "@/lib/quantity-format";
import type { CheckoutSourceQuestion } from "@/lib/api";
import {
  checkoutSourceAnswers,
  checkoutSourceOptions,
  defaultCheckoutSource,
} from "@/lib/custody-source-options";

type Props = {
  visible: boolean;
  /** The pools to ask about. One picker each. */
  questions: CheckoutSourceQuestion[];
  /** True while the check-out request runs: locks the rows, spinner on Confirm. */
  isSubmitting?: boolean;
  /** Confirm label, e.g. "Check out". */
  confirmLabel?: string;
  /** Called with the `sourceLocations` body: one answer per slice, Unplaced as `null`. */
  onConfirm: (sourceLocations: Record<string, string | null>) => void;
  /** Called when the user dismisses without confirming. Never while submitting. */
  onClose: () => void;
};

export function CheckoutSourceSheet({
  visible,
  questions,
  isSubmitting = false,
  confirmLabel = "Check out",
  onConfirm,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Rows the operator changed. Only those go out; a row left on its default
  // lets the server record its own, current default.
  const [touched, setTouched] = useState<Set<string>>(new Set());

  // Seed every question with its default each time the sheet opens, so an
  // earlier check-out's picks never leak into this one.
  useEffect(() => {
    if (!visible) return;
    const seeded: Record<string, string> = {};
    for (const question of questions) {
      seeded[question.sliceId] = defaultCheckoutSource(question);
    }
    setAnswers(seeded);
    setTouched(new Set());
  }, [visible, questions]);

  const requestClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  const canConfirm =
    !isSubmitting && questions.every((question) => answers[question.sliceId]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={requestClose}
    >
      <SafeAreaView style={styles.container} accessibilityViewIsModal={true}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Where do the units come from?</Text>
          <TouchableOpacity
            onPress={requestClose}
            disabled={isSubmitting}
            style={[styles.closeButton, isSubmitting && styles.dismissDisabled]}
            accessibilityLabel="Close where the units come from"
            accessibilityRole="button"
            accessibilityState={{ disabled: isSubmitting }}
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.intro}>
            {questions.length === 1
              ? "This item is kept at more than one location. Pick where the units leave from. Units used up on this booking come off that location at check-in."
              : "These items are kept at more than one location. Pick where each one's units leave from. Units used up on this booking come off that location at check-in."}
          </Text>

          {questions.map((question) => {
            const value = answers[question.sliceId];
            const qty =
              formatQuantity(question.quantity, question.unitOfMeasure) ??
              String(question.quantity);
            return (
              <View key={question.sliceId} style={styles.question}>
                <Text style={styles.questionTitle}>
                  {question.title}
                  <Text style={styles.questionQty}> · {qty}</Text>
                </Text>
                {checkoutSourceOptions(question).map((option) => {
                  const selected = option.value === value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[
                        styles.sourceRow,
                        selected && styles.sourceRowSelected,
                      ]}
                      onPress={() => {
                        setAnswers((prev) => ({
                          ...prev,
                          [question.sliceId]: option.value,
                        }));
                        setTouched((prev) =>
                          new Set(prev).add(question.sliceId)
                        );
                      }}
                      disabled={isSubmitting}
                      activeOpacity={0.7}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, disabled: isSubmitting }}
                      accessibilityLabel={
                        option.hint
                          ? `${question.title} from ${option.label}, ${option.hint}`
                          : `${question.title} from ${option.label}`
                      }
                    >
                      <Ionicons
                        name={selected ? "radio-button-on" : "radio-button-off"}
                        size={20}
                        color={selected ? colors.primary : colors.muted}
                      />
                      <View style={styles.sourceText}>
                        <Text style={styles.sourceRowLabel}>
                          {option.label}
                        </Text>
                        {option.hint ? (
                          <Text style={styles.sourceRowHint}>
                            {option.hint}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}

          <TouchableOpacity
            style={[
              styles.confirmButton,
              !canConfirm && styles.confirmButtonDisabled,
            ]}
            onPress={() => onConfirm(checkoutSourceAnswers(answers, touched))}
            disabled={!canConfirm}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={confirmLabel}
            accessibilityState={{ disabled: !canConfirm }}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
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
    flex: 1,
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
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  intro: {
    fontSize: fontSize.md,
    color: colors.foregroundSecondary,
    lineHeight: 20,
  },
  question: {
    gap: spacing.xs,
  },
  questionTitle: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  questionQty: {
    fontWeight: "400",
    color: colors.muted,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.white,
  },
  sourceRowSelected: {
    borderColor: colors.primary,
  },
  sourceText: {
    flex: 1,
    gap: 2,
  },
  sourceRowLabel: {
    fontSize: fontSize.md,
    fontWeight: "500",
    color: colors.foreground,
  },
  sourceRowHint: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  confirmButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
  },
  confirmButtonDisabled: {
    opacity: 0.5,
  },
  confirmText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },
}));
