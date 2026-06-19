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
 * Persistence: a single AsyncStorage flag, versioned so a future redesign
 * can re-show the hint by bumping the key.
 *
 * @see {@link file://./action-pills.tsx} the pills it points at
 */
import { useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
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
  // null = storage not read yet (render nothing to avoid a flash)
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const initialActionRef = useRef(currentAction);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!cancelled) setDismissed(value === "1");
      })
      .catch(() => {
        // why: storage failure should never block scanning — just skip the hint
        if (!cancelled) setDismissed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    AsyncStorage.setItem(STORAGE_KEY, "1").catch(() => {
      // why: best-effort persistence; worst case the hint shows once more
    });
  };

  // Switching actions proves the user found the pills — dismiss permanently.
  useEffect(() => {
    if (dismissed === false && currentAction !== initialActionRef.current) {
      dismiss();
    }
  }, [currentAction, dismissed]);

  if (!enabled || dismissed !== false) return null;

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
