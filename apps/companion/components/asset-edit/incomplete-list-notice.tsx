/**
 * The line under an inline dropdown whose list is missing rows.
 *
 * Shown by the asset forms' Location field when a page of locations failed
 * to load (with a Retry) or the load stopped at its limit, so an incomplete
 * list is never read as the whole one.
 *
 * @see {@link file://./../../lib/visible-rows.ts} `incompleteListNotice`
 */
import { View, Text, TouchableOpacity } from "react-native";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import type { IncompleteListNotice as Notice } from "@/lib/visible-rows";

type IncompleteListNoticeProps = {
  /** What to say, and whether loading again can help. */
  notice: Notice;
  /** Loads the list again. The Retry button shows only when this can help. */
  onRetry?: () => void;
  /** Screen-reader label for the Retry button, naming what is retried. */
  retryLabel: string;
};

/**
 * Renders the notice text and, for a failed load, a Retry button.
 *
 * @param props - See {@link IncompleteListNoticeProps}.
 * @returns The notice row.
 */
export function IncompleteListNotice({
  notice,
  onRetry,
  retryLabel,
}: IncompleteListNoticeProps) {
  const styles = useStyles();

  return (
    <View style={styles.notice} accessibilityRole="alert">
      <Text style={styles.noticeText}>{notice.message}</Text>
      {notice.canRetry && onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          hitSlop={8}
          accessibilityLabel={retryLabel}
          accessibilityRole="button"
        >
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.warningBg,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.warningText,
  },
  retryText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.warningText,
    textDecorationLine: "underline",
  },
}));
