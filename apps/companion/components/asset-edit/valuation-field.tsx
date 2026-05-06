import { View, Text, TextInput } from "react-native";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

type ValuationFieldProps = {
  value: string;
  onChange: (value: string) => void;
  currency: string;
};

export function ValuationField({
  value,
  onChange,
  currency,
}: ValuationFieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Value</Text>
      <View style={styles.valuationRow}>
        <Text style={styles.currencyLabel}>{currency}</Text>
        <TextInput
          style={[styles.input, styles.valuationInput]}
          value={value}
          onChangeText={(text) => {
            // Allow only numbers and one decimal point
            const cleaned = text.replace(/[^0-9.]/g, "");
            const parts = cleaned.split(".");
            if (parts.length > 2) return;
            onChange(cleaned);
          }}
          placeholder="0.00"
          placeholderTextColor={colors.placeholderText}
          keyboardType="decimal-pad"
          returnKeyType="done"
          accessibilityLabel={`Value in ${currency}`}
        />
      </View>
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
  valuationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  currencyLabel: {
    fontSize: fontSize.lg,
    fontWeight: "600",
    color: colors.muted,
    minWidth: 40,
  },
  valuationInput: {
    flex: 1,
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
}));
