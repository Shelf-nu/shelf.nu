import { memo } from "react";
import { View, Text } from "react-native";
import type { AssetDetail } from "@/lib/api";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius, formatDate } from "@/lib/constants";

type CustomField = AssetDetail["customFields"][0];

interface CustomFieldsSectionProps {
  customFields: CustomField[];
  currency: string;
}

function formatCustomFieldValue(cf: CustomField): string {
  const val = cf.value;
  if (val === null || val === undefined) return "\u2014";

  switch (cf.customField.type) {
    case "BOOLEAN":
      return val?.raw === true || val?.raw === "true" ? "Yes" : "No";
    case "DATE":
      return val?.raw ? formatDate(String(val.raw)) : "\u2014";
    case "OPTION":
      return val?.valueText || val?.raw || "\u2014";
    case "MULTILINE_TEXT":
      return val?.raw || val?.valueText || "\u2014";
    case "AMOUNT": {
      const amount = val?.raw ?? val?.valueText;
      return amount != null ? String(amount) : "\u2014";
    }
    default:
      return (
        val?.raw ?? val?.valueText ?? (typeof val === "string" ? val : "\u2014")
      );
  }
}

export const CustomFieldsSection = memo(function CustomFieldsSection({
  customFields,
}: CustomFieldsSectionProps) {
  const styles = useStyles();

  if (customFields.length === 0) return null;

  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>Custom Fields</Text>
      <View style={styles.customFieldsCard}>
        {customFields.map((cf) => (
          <View key={cf.id} style={styles.customFieldRow}>
            <Text style={styles.customFieldLabel}>{cf.customField.name}</Text>
            <Text style={styles.customFieldValue} numberOfLines={3}>
              {formatCustomFieldValue(cf)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
});

const useStyles = createStyles((colors, shadows) => ({
  sectionContainer: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  customFieldsCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.sm,
  },
  customFieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  customFieldLabel: { fontSize: fontSize.base, color: colors.muted, flex: 1 },
  customFieldValue: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
    flex: 1,
    textAlign: "right",
  },
}));
