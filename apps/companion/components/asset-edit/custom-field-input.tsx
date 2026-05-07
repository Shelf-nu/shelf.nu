import { View, Text, TextInput, Switch } from "react-native";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, borderRadius } from "@/lib/constants";

type CustomFieldInputProps = {
  field: {
    id: string;
    name: string;
    type: string;
    helpText: string | null;
  };
  value: string;
  onChange: (value: string) => void;
};

export function CustomFieldInput({
  field,
  value,
  onChange,
}: CustomFieldInputProps) {
  const { colors } = useTheme();
  const styles = useStyles();

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
            accessibilityLabel={`${field.name}: ${
              value === "true" ? "Yes" : "No"
            }`}
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
          accessibilityLabel={field.name}
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
          accessibilityLabel={field.name}
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
          accessibilityLabel={field.name}
        />
      );
    default: // TEXT, OPTION, etc.
      return (
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={`Enter ${field.name.toLowerCase()}...`}
          placeholderTextColor={colors.placeholderText}
          accessibilityLabel={field.name}
        />
      );
  }
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
}));
