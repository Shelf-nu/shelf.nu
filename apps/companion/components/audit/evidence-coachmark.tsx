/**
 * EvidenceCoachmark — one-time discoverability hint for audit evidence.
 *
 * Scanning an asset during an audit records it as found, but a field worker
 * can also attach a condition note and photos to that scan. That was reachable
 * only by tapping the scanned row, whose sole affordance was a small chevron —
 * so people finished audits without ever discovering it. The row now carries an
 * explicit "Add photo/note" action; this bubble names it once, right when the
 * first row appears.
 *
 * Dismisses permanently on "Got it" or as soon as the user opens the evidence
 * sheet on their own (proof they found it).
 *
 * @see {@link file://./scanned-items-list.tsx} the rows it points at
 * @see {@link file://./evidence-modal.tsx} what the rows open
 * @see {@link file://../../hooks/use-one-time-hint.ts} the storage contract
 */
import { useEffect } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useOneTimeHint } from "@/hooks/use-one-time-hint";
import { useTheme } from "@/lib/theme-context";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";

const STORAGE_KEY = "shelf.audit.evidence-coachmark-dismissed.v1";

type Props = {
  /** Only worth showing once there is a scanned row to point at. */
  enabled: boolean;
  /** True once the user has opened the evidence sheet — counts as discovery. */
  hasOpenedEvidence: boolean;
};

/**
 * One-time "Tap an item to add a photo or note" bubble above the scanned list.
 * Renders nothing once dismissed (persisted across sessions).
 */
export function EvidenceCoachmark({ enabled, hasOpenedEvidence }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { shouldShow, dismiss } = useOneTimeHint(STORAGE_KEY, enabled);

  // Opening the sheet proves the user found the feature — dismiss permanently.
  useEffect(() => {
    if (shouldShow && hasOpenedEvidence) {
      dismiss();
    }
  }, [shouldShow, hasOpenedEvidence, dismiss]);

  if (!shouldShow) return null;

  return (
    <View style={styles.bubble} accessibilityRole="text">
      <Ionicons name="camera-outline" size={16} color={colors.primaryText} />
      <Text style={styles.text}>
        Tap a scanned item to add a photo or condition note.
      </Text>
      <TouchableOpacity
        onPress={dismiss}
        accessibilityLabel="Dismiss audit evidence hint"
        accessibilityRole="button"
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.gotIt}>Got it</Text>
      </TouchableOpacity>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primaryBg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    color: colors.foregroundSecondary,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  gotIt: {
    color: colors.primaryText,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
}));
