/**
 * CustomFieldsSection: the "Custom Fields" card on the asset screen, one row
 * per field with its label and formatted value.
 *
 * Text values with a web link in them get the full row width under their
 * label: a value that is exactly one link shows as a chip, and a URL inside
 * other text is tappable. Every other value sits right-aligned beside its
 * label.
 *
 * @see {@link file://../../app/(tabs)/assets/[id].tsx} the asset screen
 * @see {@link file://../links/text-with-links.tsx}
 */
import { memo } from "react";
import { View, Text } from "react-native";
import type { FieldLinkTitles } from "@shelf/links";
import type { AssetDetail } from "@/lib/api";
import { customFieldLinkDisplay } from "@/lib/custom-field-links";
import { createStyles } from "@/lib/create-styles";
import {
  fontSize,
  spacing,
  borderRadius,
  formatCurrency,
} from "@/lib/constants";
import { useDateFormatter } from "@/lib/use-date-formatter";
import { LinkedText } from "@/components/links/linked-text";
import { TextWithLinks } from "@/components/links/text-with-links";

type CustomField = AssetDetail["customFields"][0];

interface CustomFieldsSectionProps {
  customFields: CustomField[];
  currency: string;
  /** `asset.fieldLinkTitles`: titles by custom field id. */
  fieldLinkTitles?: FieldLinkTitles;
}

function formatCustomFieldValue(
  cf: CustomField,
  // Bound to the acting user's date format + timezone via useDateFormatter().
  // DATE custom fields are absolute calendar dates, so the bare raw value is
  // passed through unchanged (the date-only path does not tz-shift).
  formatDate: (v: string | Date) => string,
  // Workspace currency for AMOUNT fields, matching the web overview's
  // formatCurrency rendering.
  currency: string
): string {
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
      // A blank string is a missing value, not zero — Number("") is 0.
      if (
        amount == null ||
        (typeof amount === "string" && amount.trim() === "")
      )
        return "\u2014";
      const numeric = typeof amount === "number" ? amount : Number(amount);
      return Number.isFinite(numeric)
        ? formatCurrency(numeric, currency)
        : String(amount);
    }
    default:
      return (
        val?.raw ?? val?.valueText ?? (typeof val === "string" ? val : "\u2014")
      );
  }
}

/**
 * The custom fields card, or nothing when the asset has no field values.
 *
 * @param props - Component props.
 * @param props.customFields - The rows to show, in order.
 * @param props.currency - Workspace currency for AMOUNT values.
 * @param props.fieldLinkTitles - Titles for link chips, by custom field id.
 * @returns The section, or null.
 */
export const CustomFieldsSection = memo(function CustomFieldsSection({
  customFields,
  currency,
  fieldLinkTitles,
}: CustomFieldsSectionProps) {
  const styles = useStyles();
  const { formatDate } = useDateFormatter();

  if (customFields.length === 0) return null;

  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>Custom Fields</Text>
      <View style={styles.customFieldsCard}>
        {customFields.map((cf) => {
          const value = formatCustomFieldValue(cf, formatDate, currency);
          const linkDisplay = customFieldLinkDisplay(
            cf.customField,
            value,
            fieldLinkTitles
          );
          if (linkDisplay) {
            return (
              <View
                key={cf.id}
                style={[styles.customFieldRow, styles.customFieldStackedRow]}
              >
                <Text style={styles.customFieldStackedLabel}>
                  {cf.customField.name}
                </Text>
                {linkDisplay.kind === "chips" ? (
                  <TextWithLinks
                    value={value}
                    title={linkDisplay.title}
                    style={styles.customFieldStackedValue}
                    numberOfLines={3}
                  />
                ) : (
                  <LinkedText
                    text={value}
                    style={styles.customFieldStackedValue}
                    numberOfLines={3}
                  />
                )}
              </View>
            );
          }
          return (
            <View key={cf.id} style={styles.customFieldRow}>
              <Text style={styles.customFieldLabel}>{cf.customField.name}</Text>
              <Text style={styles.customFieldValue} numberOfLines={3}>
                {value}
              </Text>
            </View>
          );
        })}
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
  // A link value takes the row's full width under its label: a chip squeezed
  // into the right half of a phone-width card would clip its words.
  customFieldStackedRow: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: spacing.sm,
  },
  customFieldStackedLabel: { fontSize: fontSize.base, color: colors.muted },
  customFieldStackedValue: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
}));
