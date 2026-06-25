/**
 * TagPickerField
 *
 * Multi-select tag picker for the asset create / edit forms. Mirrors the
 * single-select {@link PickerField} (same dropdown / search / theming) but lets
 * the user toggle several tags, shows each selected tag as a removable chip, and
 * keeps the dropdown open across selections so a batch can be picked in one pass.
 *
 * Open state is controlled by the parent (via `isOpen` / `onToggle`) so it can
 * coordinate this dropdown with sibling pickers — e.g. close the category /
 * location dropdowns when this one opens. The search text is owned internally.
 *
 * @see {@link file://./picker-field.tsx PickerField} — the single-select sibling.
 */

import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Tag } from "@/lib/api";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

type TagPickerFieldProps = {
  /** Field label. Defaults to "Tags". */
  label?: string;
  /** Every tag the user can choose from. */
  tags: Tag[];
  /** The currently selected tags. */
  selectedTags: Tag[];
  /** Called with the next selection whenever a tag is toggled or removed. */
  onChange: (next: Tag[]) => void;
  /** True while `tags` is being fetched. */
  isLoading: boolean;
  /** Whether the dropdown is open (parent-owned, so siblings can coordinate). */
  isOpen: boolean;
  /** Toggle the dropdown open/closed. */
  onToggle: (next: boolean) => void;
  /** Placeholder for the in-dropdown search input (shown when >5 tags). */
  searchPlaceholder?: string;
};

/**
 * Render the multi-select tag picker. See the file header for the controlled
 * open-state contract.
 *
 * @param props - See {@link TagPickerFieldProps}.
 */
export function TagPickerField({
  label = "Tags",
  tags,
  selectedTags,
  onChange,
  isLoading,
  isOpen,
  onToggle,
  searchPlaceholder = "Search tags...",
}: TagPickerFieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [search, setSearch] = useState("");

  const filteredTags = search
    ? tags.filter((t) => t.name.toLowerCase().includes(search.toLowerCase()))
    : tags;

  const removeTag = (id: string) =>
    onChange(selectedTags.filter((t) => t.id !== id));

  // Multi-select: add the tag if absent, remove it if already selected.
  const toggleTag = (tag: Tag) =>
    onChange(
      selectedTags.some((t) => t.id === tag.id)
        ? selectedTags.filter((t) => t.id !== tag.id)
        : [...selectedTags, tag]
    );

  const countLabel = `${selectedTags.length} tag${
    selectedTags.length === 1 ? "" : "s"
  } selected`;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={() => onToggle(!isOpen)}
        accessibilityLabel={
          selectedTags.length
            ? `${countLabel}, tap to change`
            : `Select ${label.toLowerCase()}`
        }
        accessibilityRole="button"
      >
        <Text
          style={
            selectedTags.length
              ? styles.pickerSelectedText
              : styles.pickerPlaceholder
          }
        >
          {selectedTags.length ? countLabel : "Select tags..."}
        </Text>
        <Ionicons
          name={isOpen ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedLight}
        />
      </TouchableOpacity>

      {/* Selected tags as removable chips */}
      {selectedTags.length > 0 && (
        <View style={styles.tagChips}>
          {selectedTags.map((tag) => (
            <TouchableOpacity
              key={tag.id}
              style={styles.tagChip}
              onPress={() => removeTag(tag.id)}
              accessibilityLabel={`Remove tag ${tag.name}`}
              accessibilityRole="button"
            >
              <Text style={styles.tagChipText}>{tag.name}</Text>
              <Ionicons name="close" size={14} color={colors.primary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {isOpen && (
        <View style={styles.pickerDropdown}>
          {tags.length > 5 && (
            <TextInput
              style={styles.pickerSearch}
              value={search}
              onChangeText={setSearch}
              placeholder={searchPlaceholder}
              placeholderTextColor={colors.placeholderText}
              accessibilityLabel={searchPlaceholder}
            />
          )}
          {isLoading ? (
            <ActivityIndicator
              style={styles.pickerLoading}
              color={colors.muted}
            />
          ) : filteredTags.length === 0 ? (
            <Text style={styles.pickerEmpty}>No tags found</Text>
          ) : (
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {filteredTags.map((tag) => {
                const isSelected = selectedTags.some((t) => t.id === tag.id);
                return (
                  <TouchableOpacity
                    key={tag.id}
                    style={[
                      styles.pickerItem,
                      isSelected && styles.pickerItemSelected,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={
                      isSelected ? `${tag.name}, selected` : tag.name
                    }
                    // Keep the dropdown open across toggles so several tags can
                    // be picked in one pass.
                    onPress={() => toggleTag(tag)}
                  >
                    <Ionicons
                      name="pricetag-outline"
                      size={16}
                      color={colors.muted}
                    />
                    <Text style={styles.pickerItemText}>{tag.name}</Text>
                    {isSelected && (
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
          )}
          {selectedTags.length > 0 && (
            <TouchableOpacity
              style={styles.pickerClear}
              onPress={() => {
                onChange([]);
                setSearch("");
              }}
            >
              <Text style={styles.pickerClearText}>Clear all</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  field: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    marginBottom: spacing.xs,
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
  pickerPlaceholder: {
    fontSize: fontSize.lg,
    color: colors.mutedLight,
  },
  pickerSelectedText: {
    fontSize: fontSize.lg,
    color: colors.foreground,
    fontWeight: "500",
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
  pickerSearch: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: fontSize.base,
    color: colors.foreground,
  },
  pickerLoading: {
    padding: spacing.lg,
  },
  pickerEmpty: {
    padding: spacing.lg,
    textAlign: "center",
    color: colors.mutedLight,
    fontSize: fontSize.base,
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
  tagChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  tagChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(239, 104, 32, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(239, 104, 32, 0.3)",
    borderRadius: borderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagChipText: {
    fontSize: fontSize.sm,
    color: colors.primary,
    fontWeight: "500",
  },
}));
