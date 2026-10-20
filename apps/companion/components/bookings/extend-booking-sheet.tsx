/**
 * ExtendBookingSheet: picks a new, later end for an ONGOING or OVERDUE booking.
 *
 * Opens on the booking's current end, or on now when that end has passed (an
 * OVERDUE booking), and never offers an earlier end. The user moves it with
 * the date-time picker or with the "+1 hour", "+4 hours" and "+1 day" steps,
 * then confirms.
 * The request runs with the sheet still open: a refusal (working hours, the
 * maximum length, a clash with another booking) shows inline and in an alert,
 * with the picked end kept for another try. The caller closes the sheet once
 * the server accepts.
 *
 * Built from core React Native and the shared `DateTimeField`, so it ships in
 * an over-the-air update. Follows the house sheet contract (ConfirmDeleteSheet):
 * `<Modal animationType="slide" presentationStyle="pageSheet">` + SafeAreaView
 * + header-with-close.
 *
 * @see {@link file://../confirm-delete-sheet.tsx} the sheet shell it follows
 * @see {@link file://../../lib/booking-extend.ts} the rules it applies
 * @see {@link file://../../lib/sheet-submit.ts} why the sheet stays open
 */
import { useEffect, useReducer, useRef } from "react";
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { useSheetColumnStyle } from "@/lib/use-content-gutter";
import { submitFromSheet } from "@/lib/sheet-submit";
import {
  extendFloor,
  newEndError,
  shiftEnd,
  type ExtendPreset,
} from "@/lib/booking-extend";
import { DateTimeField } from "@/components/date-time-field";

type Props = {
  /** Whether the sheet is shown. */
  visible: boolean;
  /** The booking being extended, shown so the user knows which one. */
  bookingName: string;
  /** The booking's end now; the sheet only accepts a later one. */
  currentEnd: Date;
  /** The preference zone the picker reads and a "day" step counts in. */
  timeZone: string;
  /** Formats an instant the way the booking screen does. */
  formatDateTime: (date: Date) => string;
  /** Called when the user dismisses the sheet without extending. */
  onClose: () => void;
  /**
   * Sends the extension. Resolves to the server's refusal message, or `null`
   * once it is accepted, by which point the caller has closed the sheet.
   */
  onExtend: (newEnd: Date) => Promise<string | null>;
};

/** The step buttons, in the order shown. */
const PRESETS: { preset: ExtendPreset; label: string; testID: string }[] = [
  { preset: "hour", label: "+1 hour", testID: "extend-preset-hour" },
  {
    preset: "fourHours",
    label: "+4 hours",
    testID: "extend-preset-four-hours",
  },
  { preset: "day", label: "+1 day", testID: "extend-preset-day" },
];

type SheetState = {
  /**
   * Where the sheet opened and the picker's earliest end: the current end, or
   * the moment the sheet opened when that end has passed.
   */
  floor: Date;
  /** The end the user is proposing. */
  newEnd: Date;
  /** Whether the user has moved the end since the sheet opened. */
  touched: boolean;
  /** Whether the date-time picker is mounted. */
  pickerOpen: boolean;
  /** The server's refusal of the end currently shown, if any. */
  serverError: string | null;
  /** True while the request is in flight. */
  submitting: boolean;
};

type SheetAction =
  | { type: "open"; floor: Date; pickerOpen: boolean }
  | { type: "picked"; end: Date; pickerOpen: boolean }
  | { type: "shifted"; end: Date }
  | { type: "togglePicker" }
  | { type: "closePicker" }
  | { type: "submitting"; submitting: boolean }
  | { type: "refused"; message: string };

function reducer(state: SheetState, action: SheetAction): SheetState {
  switch (action.type) {
    case "open":
      return {
        ...state,
        floor: action.floor,
        newEnd: action.floor,
        touched: false,
        pickerOpen: action.pickerOpen,
        serverError: null,
      };
    case "picked":
      // Android's final time dialog is terminal, so the picker unmounts. The
      // iOS inline picker reports every change, so it stays open until the
      // row is toggled.
      return {
        ...state,
        newEnd: action.end,
        touched: true,
        pickerOpen: action.pickerOpen,
        serverError: null,
      };
    case "shifted":
      return {
        ...state,
        newEnd: action.end,
        touched: true,
        serverError: null,
      };
    case "togglePicker":
      return { ...state, pickerOpen: !state.pickerOpen };
    case "closePicker":
      return { ...state, pickerOpen: false };
    case "submitting":
      return { ...state, submitting: action.submitting };
    case "refused":
      return { ...state, serverError: action.message };
  }
}

/**
 * New-end picker sheet for extending a booking.
 *
 * @param props - See {@link Props}.
 * @returns The modal sheet.
 */
export function ExtendBookingSheet({
  visible,
  bookingName,
  currentEnd,
  timeZone,
  formatDateTime,
  onClose,
  onExtend,
}: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const sheetColumn = useSheetColumnStyle();
  const lock = useRef(false);
  const [state, dispatch] = useReducer(reducer, {
    floor: currentEnd,
    newEnd: currentEnd,
    touched: false,
    pickerOpen: Platform.OS === "ios",
    serverError: null,
    submitting: false,
  });

  // Each opening starts from the booking's end as it is now, or from now when
  // that end has passed, so a step never lands on a time already gone. iOS
  // shows the inline picker straight away; Android's picker is a pair of
  // dialogs the row opens on request.
  const currentEndMs = currentEnd.getTime();
  useEffect(() => {
    if (!visible) return;
    dispatch({
      type: "open",
      floor: extendFloor(new Date(currentEndMs), new Date()),
      pickerOpen: Platform.OS === "ios",
    });
  }, [visible, currentEndMs]);

  // The opening instant stands in for now: the server judges the real one.
  const localError = newEndError(state.newEnd, currentEnd, state.floor);
  // An untouched sheet holds the current end, which is not yet an answer, so
  // its rule stays quiet until the user moves the end.
  const shownError = (state.touched ? localError : null) ?? state.serverError;
  const canConfirm = !state.submitting && localError === null;
  const formattedNewEnd = formatDateTime(state.newEnd);

  /** Refused while the request runs: dismissing would not cancel it. */
  const closeIfIdle = () => {
    if (state.submitting) return;
    onClose();
  };

  const confirm = () => {
    if (!canConfirm) return;
    const end = state.newEnd;
    void submitFromSheet({
      lock,
      request: async () => ({ error: await onExtend(end) }),
      // The caller closes the sheet and reports success itself.
      onAccepted: () => undefined,
      setSubmitting: (submitting) =>
        dispatch({ type: "submitting", submitting }),
      showError: (message) => {
        dispatch({ type: "refused", message });
        Alert.alert("Couldn't extend", message);
      },
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={closeIfIdle}
    >
      <SafeAreaView
        style={[styles.container, sheetColumn]}
        accessibilityViewIsModal={true}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Extend booking
          </Text>
          <TouchableOpacity
            onPress={closeIfIdle}
            disabled={state.submitting}
            style={[
              styles.closeButton,
              state.submitting && styles.buttonDisabled,
            ]}
            accessibilityLabel="Close extend booking"
            accessibilityRole="button"
          >
            <Ionicons name="close" size={24} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.bookingName}>{bookingName}</Text>
          <Text style={styles.currentEnd}>
            Currently ends {formatDateTime(currentEnd)}
          </Text>

          <Text style={styles.label}>New end</Text>
          <TouchableOpacity
            style={styles.pickerButton}
            onPress={() => dispatch({ type: "togglePicker" })}
            disabled={state.submitting}
            accessibilityRole="button"
            accessibilityLabel={`New end ${formattedNewEnd}`}
          >
            <Text style={styles.pickerText}>{formattedNewEnd}</Text>
            <Ionicons
              name="calendar-outline"
              size={18}
              color={colors.mutedLight}
            />
          </TouchableOpacity>
          {state.pickerOpen && (
            <DateTimeField
              value={state.newEnd}
              timeZoneName={timeZone}
              minimumDate={state.floor}
              onConfirm={(end) =>
                dispatch({
                  type: "picked",
                  end,
                  pickerOpen: Platform.OS === "ios",
                })
              }
              onCancel={() => dispatch({ type: "closePicker" })}
              inlineStyle={styles.dateInlineWrap}
              accentColor={colors.primary}
            />
          )}

          <View style={styles.presetRow}>
            {PRESETS.map(({ preset, label, testID }) => (
              <TouchableOpacity
                key={preset}
                testID={testID}
                style={styles.presetChip}
                onPress={() =>
                  dispatch({
                    type: "shifted",
                    end: shiftEnd(state.newEnd, preset, timeZone),
                  })
                }
                disabled={state.submitting}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityHint="Moves the new end later"
              >
                <Text style={styles.presetChipText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View style={styles.footer}>
          {shownError && (
            <Text style={styles.errorText} accessibilityRole="alert">
              {shownError}
            </Text>
          )}
          <TouchableOpacity
            testID="extend-booking-submit"
            style={[styles.submitButton, !canConfirm && styles.buttonDisabled]}
            onPress={confirm}
            disabled={!canConfirm}
            activeOpacity={0.8}
            accessibilityLabel="Confirm new end date"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canConfirm }}
          >
            {state.submitting ? (
              <ActivityIndicator color={colors.primaryForeground} />
            ) : (
              <Text style={styles.submitButtonText}>Confirm</Text>
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
    flex: 1,
    fontSize: fontSize.xl,
    fontWeight: "600",
    color: colors.foreground,
    marginRight: spacing.md,
  },
  closeButton: {
    padding: spacing.xs,
  },
  scroll: {
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  bookingName: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.foreground,
  },
  currentEnd: {
    fontSize: fontSize.md,
    color: colors.foregroundSecondary,
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foregroundSecondary,
  },
  pickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...shadows.sm,
  },
  pickerText: {
    fontSize: fontSize.lg,
    fontWeight: "500",
    color: colors.foreground,
  },
  dateInlineWrap: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  presetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetChipText: {
    fontSize: fontSize.sm,
    fontWeight: "500",
    color: colors.foreground,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  errorText: {
    fontSize: fontSize.sm,
    color: colors.error,
  },
  submitButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.sm,
    paddingVertical: 14,
    alignItems: "center",
    ...shadows.sm,
  },
  submitButtonText: {
    fontSize: fontSize.md,
    fontWeight: "600",
    color: colors.primaryForeground,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
}));
