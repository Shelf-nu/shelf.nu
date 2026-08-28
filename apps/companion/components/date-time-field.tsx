/**
 * Date + time selector for the booking forms.
 *
 * iOS renders a single inline picker in `datetime` mode, so one interaction
 * yields both halves of the value.
 *
 * Android's native pickers only take a `date` or a `time`, so this component
 * runs them back to back: the date dialog first, then the time dialog seeded
 * with the current value's clock, and reports the merged result once. Cancelling
 * either dialog cancels the whole selection and leaves the value untouched.
 *
 * Mount it only while the picker should be showing — `onConfirm` and `onCancel`
 * are both terminal, and the parent is expected to unmount on either.
 *
 * @see {@link file://../app/(tabs)/bookings/new.tsx} create-booking form.
 * @see {@link file://../app/(tabs)/bookings/edit.tsx} edit-booking form.
 */

import { useCallback, useRef, useState } from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";

type DateTimeFieldProps = {
  /** Value the picker opens on. */
  value: Date;
  /** Receives the chosen date-time once the user has confirmed every step. */
  onConfirm: (next: Date) => void;
  /** Fires when the user dismisses any step without confirming. */
  onCancel: () => void;
  /** Earliest selectable day. Applies to the date step only. */
  minimumDate?: Date;
  /** IANA zone the picker reads and reports its value in. */
  timeZoneName?: string;
  /** Wrapper style for the inline iOS picker. */
  inlineStyle?: StyleProp<ViewStyle>;
  /** Highlight colour for the native picker. */
  accentColor?: string;
};

/** Merge the calendar day of `day` with the clock of `clock`. */
function mergeDayAndClock(day: Date, clock: Date): Date {
  const merged = new Date(day);
  merged.setHours(clock.getHours(), clock.getMinutes(), 0, 0);
  return merged;
}

export function DateTimeField({
  value,
  onConfirm,
  onCancel,
  minimumDate,
  timeZoneName,
  inlineStyle,
  accentColor,
}: DateTimeFieldProps) {
  /**
   * Callbacks and the opening value live in refs because the Android picker
   * re-opens its native dialog whenever `onChange` or `value` change identity,
   * which would stack a second dialog on every parent re-render.
   */
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  const valueRef = useRef(value);

  const [androidStep, setAndroidStep] = useState<"date" | "time">("date");
  const pickedDayRef = useRef<Date | null>(null);

  const handleIosChange = useCallback(
    (event: DateTimePickerEvent, selected: Date | undefined) => {
      if (event.type !== "set" || !selected) {
        onCancelRef.current();
        return;
      }
      onConfirmRef.current(selected);
    },
    []
  );

  const handleAndroidChange = useCallback(
    (event: DateTimePickerEvent, selected: Date | undefined) => {
      if (event.type !== "set" || !selected) {
        onCancelRef.current();
        return;
      }

      if (pickedDayRef.current === null) {
        pickedDayRef.current = selected;
        setAndroidStep("time");
        return;
      }

      onConfirmRef.current(mergeDayAndClock(pickedDayRef.current, selected));
    },
    []
  );

  if (Platform.OS !== "ios") {
    return (
      <DateTimePicker
        value={
          androidStep === "time" && pickedDayRef.current
            ? mergeDayAndClock(pickedDayRef.current, valueRef.current)
            : valueRef.current
        }
        mode={androidStep}
        display="default"
        minimumDate={androidStep === "date" ? minimumDate : undefined}
        timeZoneName={timeZoneName}
        onChange={handleAndroidChange}
        accentColor={accentColor}
      />
    );
  }

  return (
    <View style={inlineStyle}>
      <DateTimePicker
        value={value}
        mode="datetime"
        display="inline"
        minimumDate={minimumDate}
        timeZoneName={timeZoneName}
        onChange={handleIosChange}
        accentColor={accentColor}
      />
    </View>
  );
}
