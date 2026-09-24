/**
 * BookingAssetsSearch — the search box above a booking's assets and kits.
 *
 * Drawn like the search box on the assets list: a search glyph, the input,
 * and a clear control once there is something to clear. It holds no state of
 * its own; the booking screen owns the term and decides what it filters.
 *
 * @see ../../app/(tabs)/bookings/[id].tsx — the only consumer
 * @see ../../lib/booking-search.ts — what a term finds
 */
import { Ionicons } from "@expo/vector-icons";
import {
  TextInput,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { borderRadius, fontSize, hitSlop, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useTheme } from "@/lib/theme-context";

type BookingAssetsSearchProps = {
  /** What the user has typed. */
  value: string;
  /** Called on every keystroke, and with `""` when the term is cleared. */
  onChangeText: (text: string) => void;
  /** Called when the input gains focus. */
  onFocus?: () => void;
  /** Reports where the box sits within its parent. */
  onLayout?: (event: LayoutChangeEvent) => void;
};

/**
 * The search box for a booking's assets and kits.
 *
 * @param props - see {@link BookingAssetsSearchProps}
 */
export function BookingAssetsSearch({
  value,
  onChangeText,
  onFocus,
  onLayout,
}: BookingAssetsSearchProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.container} onLayout={onLayout}>
      <Ionicons name="search" size={16} color={colors.mutedLight} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder="Search assets & kits"
        placeholderTextColor={colors.placeholderText}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel="Search assets and kits"
      />
      {value.length > 0 ? (
        <TouchableOpacity
          onPress={() => onChangeText("")}
          hitSlop={hitSlop.md}
          accessibilityLabel="Clear search"
          accessibilityRole="button"
        >
          <Ionicons name="close-circle" size={16} color={colors.mutedLight} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const useStyles = createStyles((colors, shadows) => ({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.gray300,
    gap: spacing.sm,
    ...shadows.sm,
  },
  input: {
    flex: 1,
    fontSize: fontSize.lg,
    color: colors.foreground,
  },
}));
