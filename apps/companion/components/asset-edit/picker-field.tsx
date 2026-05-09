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
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

type PickerItem = {
  id: string;
  name: string;
  [key: string]: any;
};

type PickerFieldProps<T extends PickerItem> = {
  label: string;
  items: T[];
  selectedId: string | null;
  onSelect: (item: T | null) => void;
  onClear: () => void;
  isLoading: boolean;
  searchPlaceholder?: string;
  /** Render the left icon/indicator for each item. Receives the item. */
  renderItemIcon?: (item: T) => React.ReactNode;
  /** Render the selected value display (left side of the button). */
  renderSelected?: (item: T) => React.ReactNode;
  /** Placeholder text when nothing is selected */
  placeholder?: string;
  /** Label for the clear action */
  clearLabel?: string;
  /** Called when the picker is toggled open/closed */
  onToggle?: (isOpen: boolean) => void;
};

export function PickerField<T extends PickerItem>({
  label,
  items,
  selectedId,
  onSelect,
  onClear,
  isLoading,
  searchPlaceholder = "Search...",
  renderItemIcon,
  renderSelected,
  placeholder = `No ${label.toLowerCase()}`,
  clearLabel = `Clear ${label.toLowerCase()}`,
  onToggle,
}: PickerFieldProps<T>) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selectedItem = items.find((item) => item.id === selectedId) ?? null;

  const filteredItems = search
    ? items.filter((item) =>
        item.name.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const toggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    onToggle?.(next);
  };

  const handleSelect = (item: T) => {
    onSelect(selectedId === item.id ? null : item);
    setIsOpen(false);
    setSearch("");
  };

  const handleClear = () => {
    onClear();
    setIsOpen(false);
    setSearch("");
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={toggleOpen}
        accessibilityLabel={
          selectedItem
            ? `${label}: ${selectedItem.name}, tap to change`
            : `Select a ${label.toLowerCase()}`
        }
        accessibilityRole="button"
      >
        {selectedItem ? (
          <View style={styles.pickerSelected}>
            {renderSelected
              ? renderSelected(selectedItem)
              : renderItemIcon
                ? renderItemIcon(selectedItem)
                : null}
            <Text style={styles.pickerSelectedText}>{selectedItem.name}</Text>
          </View>
        ) : (
          <Text style={styles.pickerPlaceholder}>{placeholder}</Text>
        )}
        <Ionicons
          name={isOpen ? "chevron-up" : "chevron-down"}
          size={18}
          color={colors.mutedLight}
        />
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.pickerDropdown}>
          {items.length > 5 && (
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
          ) : filteredItems.length === 0 ? (
            <Text style={styles.pickerEmpty}>
              No {label.toLowerCase()} found
            </Text>
          ) : (
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {filteredItems.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.pickerItem,
                    selectedId === item.id && styles.pickerItemSelected,
                  ]}
                  onPress={() => handleSelect(item)}
                >
                  {renderItemIcon?.(item)}
                  <Text style={styles.pickerItemText}>{item.name}</Text>
                  {selectedId === item.id && (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.iconActive}
                    />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {selectedId && (
            <TouchableOpacity style={styles.pickerClear} onPress={handleClear}>
              <Text style={styles.pickerClearText}>{clearLabel}</Text>
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
  pickerSelected: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
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
}));
