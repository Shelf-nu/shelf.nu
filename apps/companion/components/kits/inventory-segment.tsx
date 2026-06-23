/**
 * InventorySegment — the "Assets | Kits" segmented switcher shown at the top
 * of both inventory list screens.
 *
 * Both lists live in the SAME stack (the Assets tab), so switching uses
 * `router.replace` within the stack: the tab bar keeps Assets active, no
 * push animation accumulates, and back behavior stays natural. Kits get
 * equal billing with assets (matching the web sidebar, where they are
 * siblings) without growing the tab bar past five items.
 *
 * @see {@link file://../../app/(tabs)/assets/index.tsx} assets list (segment: assets)
 * @see {@link file://../../app/(tabs)/assets/kits/index.tsx} kits list (segment: kits)
 */
import { View, Text, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { fontSize, spacing, borderRadius } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";

type Props = {
  /** Which segment the hosting screen represents. */
  active: "assets" | "kits";
};

/** Two-segment Assets/Kits switcher; replaces within the Assets stack. */
export function InventorySegment({ active }: Props) {
  const styles = useStyles();

  const switchTo = (target: "assets" | "kits") => {
    if (target === active) return;
    // replace (not push) so the lists swap in place with no back-stack growth
    router.replace(
      target === "assets" ? "/(tabs)/assets" : "/(tabs)/assets/kits"
    );
  };

  return (
    <View
      style={styles.track}
      accessibilityRole="tablist"
      accessibilityLabel="Inventory type"
    >
      {(["assets", "kits"] as const).map((segment) => {
        const isActive = segment === active;
        return (
          <TouchableOpacity
            key={segment}
            style={[styles.segment, isActive && styles.segmentActive]}
            onPress={() => switchTo(segment)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={segment === "assets" ? "Assets" : "Kits"}
            activeOpacity={0.7}
          >
            <Text style={[styles.label, isActive && styles.labelActive]}>
              {segment === "assets" ? "Assets" : "Kits"}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  track: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: 3,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.backgroundTertiary,
  },
  segment: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderRadius: borderRadius.md,
  },
  segmentActive: {
    backgroundColor: colors.white,
  },
  label: {
    fontSize: fontSize.base,
    fontWeight: "600",
    color: colors.muted,
  },
  labelActive: {
    color: colors.foreground,
  },
}));
