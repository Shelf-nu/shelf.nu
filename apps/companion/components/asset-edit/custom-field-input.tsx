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
 * - `DATE`            — single-line `TextInput` with `YYYY-MM-DD` placeholder.
 * - `NUMBER`/`AMOUNT` — numeric keyboard, strips non-numeric chars on input.
 * - `OPTION`          — tap-to-open dropdown picker over `field.options`.
 *                       Falls back to a plain text input when options are
 *                       missing (degraded but safe — see below).
 * - everything else   — plain single-line `TextInput`.
 *
 * @see {@link file://../../lib/api/types.ts MobileCustomFieldDefinition}
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Switch,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
    type: string;
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
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.placeholderText}
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
            {options.map((opt) => {
              const selected = opt === value;
              return (
                <TouchableOpacity
                  key={opt}
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
}));
