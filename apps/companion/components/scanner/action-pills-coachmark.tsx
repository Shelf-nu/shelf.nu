/**
 * ActionPillsCoachmark — one-time discoverability hint for the scanner's
 * action pills.
 *
 * The scanner supports four actions (View / Assign / Release / Location)
 * switched by tapping the pills or swiping the camera area, but the
 * affordance is subtle enough that even power users have missed it. This
 * renders a small dismissible bubble under the pills on first use; it goes
 * away forever once dismissed or once the user switches actions on their
 * own (proof they found the feature).
 *
 * Persistence: a single AsyncStorage flag via `useOneTimeHint`, versioned so
 * a future redesign can re-show the hint by bumping the key.
 *
 * @see {@link file://./action-pills.tsx} the pills it points at
 * @see {@link file://../../hooks/use-one-time-hint.ts} the storage contract
 */
import { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { useOneTimeHint } from "@/hooks/use-one-time-hint";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";

const STORAGE_KEY = "shelf.scanner.pills-coachmark-dismissed.v1";

type Props = {
  /** Render only when the user actually has multiple actions to discover. */
  enabled: boolean;
  /** Current scanner action — changing it counts as discovery and dismisses. */
  currentAction: string;
};

/**
 * One-time "Tap or swipe to switch actions" bubble. Returns null once
 * dismissed (persisted across sessions).
 */
export function ActionPillsCoachmark({ enabled, currentAction }: Props) {
  const styles = useStyles();
  const { shouldShow, dismiss } = useOneTimeHint(STORAGE_KEY, enabled);
  const initialActionRef = useRef(currentAction);

  // Switching actions proves the user found the pills — dismiss permanently.
  useEffect(() => {
    if (shouldShow && currentAction !== initialActionRef.current) {
      dismiss();
    }
  }, [currentAction, shouldShow, dismiss]);

  if (!shouldShow) return null;

  return (
    <View
      style={styles.bubble}
      accessibilityRole="text"
      pointerEvents="box-none"
    >
      <Text style={styles.text}>
        Tap a pill or swipe the camera to switch between view and batch actions
      </Text>
      <TouchableOpacity
        onPress={dismiss}
        accessibilityLabel="Dismiss scanner actions hint"
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
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: borderRadius.lg,
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
    maxWidth: 360,
  },
  text: {
    flex: 1,
    color: "#fff",
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  gotIt: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: "700",
  },
}));
