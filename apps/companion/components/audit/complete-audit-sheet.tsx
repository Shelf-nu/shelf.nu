/**
 * CompleteAuditSheet — the confirmation for finishing an audit, and the one
 * place its closing note can be written.
 *
 * Completing is the irreversible step: every expected asset nobody scanned is
 * marked missing, and the counts are finalised into the record the report is
 * built from. So the sheet states that consequence in numbers before the
 * button, and offers a note for the thing numbers cannot carry — why the
 * missing ones are missing.
 *
 * The note is optional and free text, capped to match the server's own limit.
 * Follows the house selection-flow contract (QuantityInputSheet,
 * TeamMemberPicker): page-sheet modal, header with close, explicit confirm.
 * React Native has no usable text prompt — `Alert.prompt` is iOS-only — which
 * is why an Alert cannot do this job.
 *
 * The confirm button IS the confirmation: callers must not stack an Alert on
 * top of `onConfirm`.
 *
 * @see {@link file://../../app/(tabs)/audits/[id].tsx} the detail-screen consumer
 * @see {@link file://../../app/(tabs)/audits/scan.tsx} the scanner consumer
 * @see {@link file://../quantity-input-sheet.tsx} the modal contract this mirrors
 */
import { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

/** Matches the server's `completionNote` bound in api+/mobile+/audits.complete.ts. */
const MAX_NOTE_LENGTH = 5000;

type Props = {
  /** Whether the sheet is shown. */
  visible: boolean;
  /** The audit being completed — named in the body so the act is unambiguous. */
  auditName: string;
  /** Expected assets nobody scanned. These become missing on completion. */
  pendingCount: number;
  /** True while the completion request is in flight. */
  isSubmitting: boolean;
  /** Dismiss without completing. */
  onClose: () => void;
  /** Complete the audit, with the note when one was written. */
  onConfirm: (completionNote?: string) => void;
};

/**
 * Confirmation sheet for completing an audit, with an optional closing note.
 *
 * Completion is irreversible and turns every unscanned expected asset into a
 * missing one, so the sheet names the audit and that count before it will
 * confirm.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet element.
 */
export function CompleteAuditSheet({
  visible,
  auditName,
  pendingCount,
  isSubmitting,
  onClose,
  onConfirm,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [note, setNote] = useState("");

  // A note belongs to the audit it was written for, so each opening starts
  // empty rather than carrying the previous one forward.
  useEffect(() => {
    if (visible) setNote("");
  }, [visible]);

  const trimmedNote = note.trim();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              Complete audit
            </Text>
            <TouchableOpacity
              onPress={onClose}
              accessibilityLabel="Close"
              accessibilityRole="button"
              disabled={isSubmitting}
            >
              <Ionicons name="close" size={24} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={styles.body}>
            <Text style={styles.lead}>Finish “{auditName}”?</Text>
            <Text
              style={[styles.consequence, pendingCount > 0 && styles.warning]}
            >
              {pendingCount > 0
                ? `${pendingCount} unscanned ${
                    pendingCount === 1 ? "asset" : "assets"
                  } will be marked as missing.`
                : "All expected assets have been found."}
            </Text>

            <Text style={styles.label}>Closing note (optional)</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="Anything worth recording — why an asset is missing, who was asked, what happens next."
              placeholderTextColor={colors.placeholderText}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={MAX_NOTE_LENGTH}
              editable={!isSubmitting}
              accessibilityLabel="Closing note for this audit"
            />
            <Text style={styles.hint}>
              Saved with the audit and shown in its report.
            </Text>
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.confirm}
              onPress={() => onConfirm(trimmedNote || undefined)}
              disabled={isSubmitting}
              accessibilityRole="button"
              accessibilityLabel={`Complete the audit ${auditName}`}
              accessibilityState={{ disabled: isSubmitting }}
            >
              {isSubmitting ? (
                <ActivityIndicator
                  size="small"
                  color={colors.primaryForeground}
                />
              ) : (
                <Text style={styles.confirmText}>Complete audit</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
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
    fontSize: fontSize.lg,
    fontWeight: "700",
    color: colors.foreground,
  },
  body: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  lead: { fontSize: fontSize.md, fontWeight: "600", color: colors.foreground },
  consequence: { fontSize: fontSize.sm, color: colors.muted },
  warning: { color: colors.error },
  label: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
    marginTop: spacing.md,
  },
  input: {
    minHeight: 108,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.backgroundSecondary,
    padding: spacing.md,
    fontSize: fontSize.md,
    color: colors.foreground,
  },
  hint: { fontSize: fontSize.xs, color: colors.mutedLight },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  confirm: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: {
    color: colors.primaryForeground,
    fontSize: fontSize.md,
    fontWeight: "700",
  },
}));
