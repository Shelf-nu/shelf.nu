/**
 * DocumentsLinksSection: the "Documents & links" card on the asset screen,
 * the phone's version of the web overview card of the same name.
 *
 * One row per Link-format custom field that applies to the asset, set or
 * not: the field name, then its link as a chip (or the text as stored, with
 * any URL in it tappable), or a muted "Not linked". Renders nothing when the
 * server sends no `linkFields`, so older servers show the screen as before.
 *
 * @see {@link file://../../lib/custom-field-links.ts} `splitLinkFields` builds the rows
 * @see {@link file://../../app/(tabs)/assets/[id].tsx} the asset screen
 */
import { memo } from "react";
import { Text, View } from "react-native";
import type { FieldLinkTitles } from "@shelf/links";
import type { LinkFieldRow } from "@/lib/custom-field-links";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { TextWithLinks } from "@/components/links/text-with-links";

/**
 * The Documents & links card, or nothing when there are no rows.
 *
 * @param props - Component props.
 * @param props.rows - One row per Link field, in display order.
 * @param props.titles - `asset.fieldLinkTitles`, for the chips' titles.
 * @returns The section, or null.
 */
export const DocumentsLinksSection = memo(function DocumentsLinksSection({
  rows,
  titles,
}: {
  rows: readonly LinkFieldRow[];
  titles?: FieldLinkTitles;
}) {
  const styles = useStyles();

  if (rows.length === 0) return null;

  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        Documents & links
      </Text>
      <View style={styles.card}>
        {rows.map((row, index) => (
          <View
            key={row.id}
            style={[styles.row, index === rows.length - 1 && styles.lastRow]}
          >
            <Text style={styles.label}>{row.name}</Text>
            {row.value ? (
              <TextWithLinks
                value={row.value}
                title={titles?.[row.id]}
                style={styles.value}
                numberOfLines={3}
              />
            ) : (
              <Text style={styles.notLinked}>Not linked</Text>
            )}
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
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
    ...shadows.sm,
  },
  // Label above value at full width: a chip needs the whole row on a phone.
  row: {
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  lastRow: { borderBottomWidth: 0 },
  label: { fontSize: fontSize.base, color: colors.muted },
  value: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.foreground,
  },
  notLinked: { fontSize: fontSize.base, color: colors.muted },
}));
