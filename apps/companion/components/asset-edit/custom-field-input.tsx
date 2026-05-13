/**
 * CustomFieldInput
 *
 * Renders the correct input control for a Shelf custom field based on the
 * field's `type`. Used by the asset create (`new.tsx`) and edit (`edit.tsx`)
 * screens. Keeps both screens visually and behaviourally consistent and
 * centralises accessibility metadata so a single fix here improves both
 * call sites.
 *
 * Supported types:
 * - `BOOLEAN`         — native `Switch` with a "Yes"/"No" label.
 * - `MULTILINE_TEXT`  — multi-line `TextInput`.
 * - `DATE`            — native date picker (iOS inline / Android dialog).
 * - `NUMBER`/`AMOUNT` — numeric keyboard, strips non-numeric chars on input.
 * - `OPTION`          — tap-to-open dropdown picker over `field.options`.
 *                       Falls back to a plain text input when options are
 *                       missing (degraded but safe — see below).
 * - everything else   — plain single-line `TextInput`.
 *
 * @see {@link file://../../lib/api/types.ts MobileCustomFieldDefinition}
 */

import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
} from "react-native";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import type { MobileCustomFieldType } from "@/lib/api";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { labelForRequired } from "@/lib/a11y";

/**
 * Field metadata consumed by `CustomFieldInput`. `required` defaults to
 * `false` when omitted so call sites that don't track required-ness (e.g.
 * the edit screen, which derives state from `AssetDetail.customFields`)
 * still type-check without changes.
 */
type CustomFieldInputProps = {
  field: {
    id: string;
    name: string;
    /**
     * Field type from the canonical {@link MobileCustomFieldType} union.
     * Using the literal union (not `string`) catches casing mismatches at
     * compile time — the most common confusion is webapp internals using
     * lowercase identifiers while the database / mobile API contract is
     * uppercase.
     */
    type: MobileCustomFieldType;
    helpText: string | null;
    required?: boolean;
    options?: string[] | null;
  };
  value: string;
  onChange: (value: string) => void;
  /**
   * Optional inline error. Appended to the `accessibilityLabel` so screen
   * readers announce the failure alongside the field name.
   */
  error?: string;
};

/**
 * Render the right input control for a single custom field.
 *
 * Selects the appropriate component per `field.type` (boolean toggle,
 * multiline text, numeric input, OPTION dropdown, default text input).
 * Each branch threads `accessibilityLabel` (via `labelForRequired` when
 * `required`) and `accessibilityHint` (from `helpText`) so VoiceOver /
 * TalkBack announce the field correctly.
 *
 * @param field    Definition (id / name / type / helpText / required / options).
 * @param value    Current string value from the parent form's id → value map.
 * @param onChange Setter invoked with the new string value on every change.
 * @param error    Optional inline error; appended to the accessibility label.
 * @returns A React Native input component wired to `value` / `onChange`.
 * @throws Never — branches without a matching `field.type` fall back to a
 *   plain text input so unknown / future types remain usable.
 */
export function CustomFieldInput({
  field,
  value,
  onChange,
  error,
}: CustomFieldInputProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const required = field.required === true;
  // `labelForRequired` appends ", required" to the label so VoiceOver and
  // TalkBack announce required-ness. We do this instead of
  // `accessibilityState.required` because React Native's AccessibilityState
  // type doesn't include `required` (it's an ARIA/web concept). Same for
  // `invalid` — we surface errors visually only and via the label here.
  const baseLabel = required ? labelForRequired(field.name) : field.name;
  const accessibilityLabel = error
    ? `${baseLabel}, invalid: ${error}`
    : baseLabel;
  // `accessibilityHint` adds extra context spoken AFTER the label
  // (e.g. "Visible to all team members"). Surfaces helpText to AT users
  // without cluttering the visual layout further.
  const accessibilityHint = field.helpText ?? undefined;

  switch (field.type) {
    case "BOOLEAN":
      return (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>
            {value === "true" ? "Yes" : "No"}
          </Text>
          <Switch
            value={value === "true"}
            onValueChange={(val) => onChange(val ? "true" : "false")}
            trackColor={{ true: colors.primary, false: colors.gray300 }}
            thumbColor={colors.white}
            accessibilityLabel={`${accessibilityLabel}: ${
              value === "true" ? "Yes" : "No"
            }`}
            accessibilityHint={accessibilityHint}
          />
        </View>
      );
    case "MULTILINE_TEXT":
      return (
        <TextInput
          style={[styles.input, styles.textArea]}
          value={value}
          onChangeText={onChange}
          placeholder={`Enter ${field.name.toLowerCase()}...`}
          placeholderTextColor={colors.placeholderText}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
        />
      );
    case "DATE":
      return (
        <DateFieldInput
          value={value}
          onChange={onChange}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
        />
      );
    case "AMOUNT":
    case "NUMBER":
      return (
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={(val) => {
            const cleaned = val.replace(/[^0-9.-]/g, "");
            onChange(cleaned);
          }}
          placeholder="0"
          placeholderTextColor={colors.placeholderText}
          keyboardType="decimal-pad"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
        />
      );
    case "OPTION":
      return (
        <OptionDropdown
          field={field}
          value={value}
          onChange={onChange}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
        />
      );
    default: // TEXT and any unknown future types
      return (
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={`Enter ${field.name.toLowerCase()}...`}
          placeholderTextColor={colors.placeholderText}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
        />
      );
  }
}

/**
 * Dropdown picker for `OPTION` custom fields.
 *
 * Matches the look-and-feel of the Category / Location pickers in `new.tsx`:
 * a `TouchableOpacity` showing the current selection that expands inline
 * into a scrollable list. If `field.options` is missing or empty (server
 * misconfiguration or older data), gracefully degrades to a plain text
 * input so the user is never locked out of editing the field.
 */
function OptionDropdown({
  field,
  value,
  onChange,
  accessibilityLabel,
  accessibilityHint,
}: {
  field: CustomFieldInputProps["field"];
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
  accessibilityHint: string | undefined;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  const options = field.options ?? [];

  // Degraded fallback: if no options are configured, render a plain text
  // input so the screen is still usable.
  if (options.length === 0) {
    return (
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={`Enter ${field.name.toLowerCase()}...`}
        placeholderTextColor={colors.placeholderText}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
      />
    );
  }

  return (
    <View>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={
          value
            ? `${accessibilityLabel}: ${value}, tap to change`
            : `${accessibilityLabel}, tap to choose`
        }
        accessibilityHint={accessibilityHint}
        accessibilityState={{ expanded: open }}
      >
        <Text
          style={value ? styles.pickerSelectedText : styles.pickerPlaceholder}
        >
          {value || "Select an option..."}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedLight}
        />
      </TouchableOpacity>

      {open && (
        <View style={styles.pickerDropdown}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {options.map((opt, index) => {
              const selected = opt === value;
              return (
                <TouchableOpacity
                  // why: index in the key guards against duplicate option
                  // labels (we don't enforce uniqueness server-side).
                  // Without it React's reconciliation would mis-attribute
                  // selection state on collision.
                  key={`${opt}-${index}`}
                  style={[
                    styles.pickerItem,
                    selected && styles.pickerItemSelected,
                  ]}
                  onPress={() => {
                    onChange(selected ? "" : opt);
                    setOpen(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.pickerItemText}>{opt}</Text>
                  {selected && (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.iconActive}
                    />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {value && (
            <TouchableOpacity
              style={styles.pickerClear}
              onPress={() => {
                onChange("");
                setOpen(false);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Clear ${field.name}`}
            >
              <Text style={styles.pickerClearText}>Clear selection</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Native date picker for `DATE` custom fields.
 *
 * Closed state mirrors the `OptionDropdown` look-and-feel (same `pickerButton`
 * style + chevron-equivalent calendar icon) so the form reads consistently.
 * Tap reveals the platform-native picker:
 *
 * - iOS: inline calendar below the field. Auto-collapses on selection so the
 *   form stays scannable; re-opening is one tap away.
 * - Android: native modal dialog (provided by the OS), auto-closes itself.
 *
 * The wire format is `YYYY-MM-DD` (matches `MobileCustomFieldType.DATE`
 * server contract — see `lib/api/types.ts`). Parsing the existing value uses
 * local-time `Date` construction to avoid the UTC-shift footgun (e.g. a
 * stored "2026-01-15" rendering as Jan 14 in negative-UTC timezones).
 */
function DateFieldInput({
  value,
  onChange,
  accessibilityLabel,
  accessibilityHint,
}: {
  value: string;
  onChange: (value: string) => void;
  accessibilityLabel: string;
  accessibilityHint: string | undefined;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [open, setOpen] = useState(false);

  const dateValue = useMemo(() => {
    if (!value) return new Date();
    // Parse `YYYY-MM-DD` as a local date (NOT `new Date(value)`, which
    // interprets the bare date as UTC midnight and shifts the day in
    // negative-offset timezones).
    const [y, m, d] = value.split("-").map(Number);
    if (!y || !m || !d) return new Date();
    // why: the truthiness check above lets through nonsense like
    // "2026-13-99" or "2026-02-30" — JS's Date constructor silently
    // overflows (2026-02-30 → 2026-03-02), which would render a
    // confusing date on the picker. Construct, then verify the
    // round-trip matches the input. If a server bug ever ships a bad
    // YYYY-MM-DD string, this falls back to "today" instead of a
    // silently wrong date.
    const parsed = new Date(y, m - 1, d);
    if (
      parsed.getFullYear() !== y ||
      parsed.getMonth() + 1 !== m ||
      parsed.getDate() !== d
    ) {
      return new Date();
    }
    return parsed;
  }, [value]);

  const handleChange = (
    event: DateTimePickerEvent,
    selected: Date | undefined
  ) => {
    // Android's native dialog dismisses itself; sync our wrapper state.
    if (Platform.OS === "android") {
      setOpen(false);
    }
    if (event.type === "dismissed") {
      return;
    }
    if (selected) {
      const y = selected.getFullYear();
      const m = String(selected.getMonth() + 1).padStart(2, "0");
      const d = String(selected.getDate()).padStart(2, "0");
      onChange(`${y}-${m}-${d}`);
      // iOS inline picker stays open by default — close it on selection so
      // the form remains scannable. Re-tapping the field re-opens it.
      if (Platform.OS === "ios") {
        setOpen(false);
      }
    }
  };

  return (
    <View>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={
          value
            ? `${accessibilityLabel}: ${value}, tap to change`
            : `${accessibilityLabel}, tap to choose`
        }
        accessibilityHint={accessibilityHint}
        accessibilityState={{ expanded: open }}
      >
        <Text
          style={value ? styles.pickerSelectedText : styles.pickerPlaceholder}
        >
          {value || "Select date..."}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={colors.mutedLight} />
      </TouchableOpacity>

      {open && (
        <View style={Platform.OS === "ios" ? styles.dateInlineWrap : undefined}>
          <DateTimePicker
            testID="custom-field-date-picker"
            value={dateValue}
            mode="date"
            display={Platform.OS === "ios" ? "inline" : "default"}
            onChange={handleChange}
            accentColor={colors.primary}
          />
        </View>
      )}

      {/*
        Always-visible clear affordance when the field has a value. Mirrors
        the OptionDropdown's `pickerClear` pattern but sits OUTSIDE the
        `open` branch because on Android the picker is a modal dialog —
        anything inside `open` is hidden behind the OS sheet, so there'd
        be no UI window to surface "Clear" via that path. For optional
        DATE fields, this is the only way to send `null` and reset the
        server-side value (see `buildCustomFieldPayloadValue`).
      */}
      {value ? (
        <TouchableOpacity
          style={styles.dateClearRow}
          onPress={() => {
            onChange("");
            setOpen(false);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${accessibilityLabel}`}
        >
          <Text style={styles.pickerClearText}>Clear date</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
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
  textArea: {
    minHeight: 80,
    paddingTop: 12,
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...shadows.sm,
  },
  switchLabel: {
    fontSize: fontSize.lg,
    color: colors.foreground,
  },

  // ── Dropdown (mirrors picker styles from new.tsx) ──────────
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
  pickerPlaceholder: {
    fontSize: fontSize.lg,
    color: colors.mutedLight,
    flex: 1,
  },
  pickerSelectedText: {
    fontSize: fontSize.lg,
    color: colors.foreground,
    fontWeight: "500",
    flex: 1,
  },
  pickerDropdown: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: borderRadius.sm,
    marginTop: spacing.xs,
    maxHeight: 220,
    ...shadows.md,
  },
  pickerItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  pickerItemSelected: {
    backgroundColor: colors.backgroundTertiary,
  },
  pickerItemText: {
    flex: 1,
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  pickerClear: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: "center",
  },
  pickerClearText: {
    fontSize: fontSize.sm,
    color: colors.error,
    fontWeight: "500",
  },

  // Inline DateTimePicker (iOS) wrapper — gives the calendar room to
  // breathe under the field button without colliding with the next field.
  dateInlineWrap: {
    marginTop: spacing.xs,
  },
  // Clear affordance row below the date picker button — only rendered when
  // the field has a value. Sits outside the picker open/closed state so
  // Android (modal dialog) users can still clear without opening the picker.
  dateClearRow: {
    alignSelf: "flex-end",
    paddingVertical: spacing.xs,
    paddingHorizontal: 4,
    marginTop: spacing.xs,
  },
}));
