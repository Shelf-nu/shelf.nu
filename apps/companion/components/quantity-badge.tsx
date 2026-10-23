/**
 * QuantityBadge — the single shared "how many units" chip for
 * QUANTITY_TRACKED assets. One look everywhere it appears (inventory list,
 * booking rows, ...) so the same concept never renders four different ways.
 *
 * The number's MEANING is surface-specific and the caller owns it: workspace
 * stock on the assets list, booked units on a booking row, units-in-kit on a
 * kit. Pass the right `value` plus an optional `label` ("booked", "in kit") to
 * disambiguate meaning without changing the look — same chip, different value.
 *
 * @see {@link file://../lib/quantity-format.ts} formatQuantity
 * @see {@link file://../app/(tabs)/assets/index.tsx} inventory-list consumer
 * @see {@link file://../app/(tabs)/bookings/[id].tsx} booking-row consumer
 */
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fontSize, borderRadius } from "@/lib/constants";
import { useTheme } from "@/lib/theme-context";
import { createStyles } from "@/lib/create-styles";
import { formatQuantity } from "@/lib/quantity-format";

type Props = {
  /** Unit count for this surface (stock / booked / in-kit — caller decides). */
  value: number | null | undefined;
  /** Display unit echoed after the count, e.g. "pcs". */
  unitOfMeasure?: string | null;
  /** Optional meaning suffix rendered lighter, e.g. "booked". */
  label?: string;
};

/**
 * Neutral count chip: a layers icon + "N unit" (+ optional meaning label).
 * Renders nothing when `value` is not a finite number, so callers can drop it
 * in unconditionally for mixed INDIVIDUAL / QUANTITY_TRACKED lists.
 *
 * @param props - See {@link Props}.
 * @returns The chip element, or null when there is no quantity to show.
 */
export function QuantityBadge({ value, unitOfMeasure, label }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();

  if (value == null || !Number.isFinite(value)) return null;

  const qty = formatQuantity(value, unitOfMeasure) ?? String(value);

  return (
    <View
      style={styles.badge}
      accessibilityLabel={label ? `${qty} ${label}` : qty}
    >
      <Ionicons name="layers-outline" size={11} color={colors.muted} />
      <Text style={styles.text} numberOfLines={1}>
        {qty}
        {label ? <Text style={styles.label}> {label}</Text> : null}
      </Text>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    gap: 3,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: "500",
    color: colors.muted,
  },
  label: {
    fontWeight: "400",
    color: colors.muted,
  },
}));
