/**
 * ConfirmDeleteSheet: the typed confirmation for a permanent delete.
 *
 * Shown instead of a two-button alert for the deletes the app offers (an asset,
 * a booking). It says what the delete removes and keeps the destructive button
 * disabled until the user types the item's name. Matching is
 * `deleteConfirmationMatches` from `@shelf/labels`, the same rule the webapp's
 * delete dialogs use, so a name that unlocks the website unlocks the phone.
 *
 * Built from core React Native only (`Modal`, `TextInput`), so it ships in an
 * over-the-air update. Follows the house sheet contract
 * (ConnectServerSheet, TeamMemberPicker): `<Modal animationType="slide"
 * presentationStyle="pageSheet">` + SafeAreaView + header-with-close.
 *
 * @see {@link file://./connect-server-sheet.tsx} the sheet it is modelled on
 * @see {@link file://../../../packages/labels/index.js} deleteConfirmationMatches
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
import { deleteConfirmationMatches } from "@shelf/labels";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";

type Props = {
  /** Whether the sheet is shown. */
  visible: boolean;
  /** Sheet heading, e.g. "Delete asset". */
  title: string;
  /** What the delete removes, in plain words. */
  message: string;
  /** The item's name, which the user types to unlock the delete. */
  expected: string;
  /** True while the delete request is in flight. */
  isDeleting: boolean;
  /** Runs the delete. The caller closes the sheet once it is done. */
  onConfirm: () => void;
  /** Called when the user dismisses the sheet without deleting. */
  onClose: () => void;
};

/**
 * Typed-name delete confirmation sheet.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet.
 */
export default function ConfirmDeleteSheet({
  visible,
  title,
  message,
  expected,
  isDeleting,
  onConfirm,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const inputRef = useRef<TextInput>(null);
  const [typed, setTyped] = useState("");

  const isArmed = !isDeleting && deleteConfirmationMatches(typed, expected);

  // Hidden by the caller (after a delete, or a failed one): start empty next
  // time. Resetting here rather than on open avoids repainting the field while
  // the sheet slides in.
  useEffect(() => {
    if (!visible) setTyped("");
  }, [visible]);

  /**
   * Clears the field on the way out, so a name typed for one attempt never
   * arms the next. Refused while the delete is in flight: dismissing would not
   * cancel the request.
   */
  const closeAndReset = () => {
    if (isDeleting) return;
    setTyped("");
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeAndReset}
      // why: imperative focus once the sheet has actually presented; an
      // autoFocus prop fires before the modal animation and misses the keyboard.
      onShow={() => inputRef.current?.focus()}
    >
      <SafeAreaView style={styles.container} accessibilityViewIsModal={true}>
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
          <TouchableOpacity
            onPress={closeAndReset}
            disabled={isDeleting}
            style={[styles.closeButton, isDeleting && styles.buttonDisabled]}
            accessibilityLabel={`Close ${title.toLowerCase()}`}
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.message}>{message}</Text>

          <Text style={styles.label}>
            To confirm, type <Text style={styles.expected}>{expected}</Text>{" "}
            below.
          </Text>
          <TextInput
            testID="delete-confirmation-input"
            ref={inputRef}
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="done"
            editable={!isDeleting}
            accessibilityLabel="Confirmation"
            accessibilityHint={`Type ${expected} to enable delete`}
          />

          <TouchableOpacity
            testID="confirm-delete-button"
            style={[styles.deleteButton, !isArmed && styles.buttonDisabled]}
            onPress={onConfirm}
            disabled={!isArmed}
            activeOpacity={0.8}
            accessibilityLabel={title}
            accessibilityRole="button"
            accessibilityState={{ disabled: !isArmed }}
          >
            {isDeleting ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={styles.deleteButtonText}>Delete</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={closeAndReset}
            disabled={isDeleting}
            accessibilityLabel="Cancel"
            accessibilityRole="button"
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
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
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: "600",
    color: colors.foreground,
    marginRight: spacing.md,
  },
  closeButton: {
    padding: spacing.xs,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  message: {
    fontSize: fontSize.lg,
    color: colors.foregroundSecondary,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foregroundSecondary,
  },
  expected: {
    fontWeight: "700",
    color: colors.foreground,
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: fontSize.lg,
    color: colors.foreground,
    ...shadows.sm,
  },
  deleteButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.sm,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: spacing.md,
    ...shadows.sm,
  },
  deleteButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.white,
  },
  cancelButton: {
    borderRadius: borderRadius.sm,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.foreground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
}));
