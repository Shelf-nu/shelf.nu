/**
 * BookingKitHeader — the row a booking's kit members sit under.
 *
 * The phone shows a kit as one thing: its picture, its name, how many of its
 * assets this booking holds, and one status for that group. The members stay
 * one tap away rather than scattered through the list by the status sort,
 * which is what the website does and what an operator packing a case expects
 * to see.
 *
 * A booking may hold only PART of a kit. `memberCount` is therefore the number
 * of members on this booking and never the kit's own `assetCount`:
 * `splitRemovalSelection` compares those two to decide whether a removal may
 * name the kit instead of its assets, and naming a kit detaches every asset in
 * it — including the ones this booking never held.
 *
 * Two presses live on this row and they cannot both be the whole row. Outside
 * selection the chevron is on the left and the row opens and closes. Inside
 * selection every kit row has the same slots in the same order, so the
 * pictures, names, badges and chevrons line up down the list: a 22 x 22 slot on
 * the left, the picture, the name and count, the badge, and a chevron on the
 * right that opens and closes. A kit that the current mode can act on has a
 * tick box in the left slot, and the row picks the members, because the tap
 * that selects is the one an operator is repeating. A kit that the mode cannot
 * act on has an empty left slot, the same as an asset row in that state has no
 * tick box, and a tap on the row opens and closes it.
 *
 * @see ../../lib/booking-kit-rows.ts — the rules this renders
 * @see ../../../webapp/app/components/booking/kit-row.tsx — the web row
 */
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Text, TouchableOpacity, View } from "react-native";

import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useTheme } from "@/lib/theme-context";
import type {
  BookingKitBadge,
  KitSelectionState,
} from "@/lib/booking-kit-rows";
import type { BookingKit } from "@/lib/api/types";

/** Widens the tap target of the small controls to a comfortable size. */
const CONTROL_HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 };

type BookingKitHeaderProps = {
  /** The kit record, or null when the server sent no kit details. */
  kit: BookingKit | null;
  /** The kit's name, which the member assets carry even without a record. */
  name: string;
  /** How many of the kit's assets this booking holds. */
  memberCount: number;
  /** The status badge to show, or null when there is nothing to say. */
  badge: BookingKitBadge | null;
  expanded: boolean;
  /**
   * Null outside selection; otherwise how much of the kit is picked.
   * "unselectable" leaves the left slot empty: no tick box.
   */
  selectionState: KitSelectionState | null;
  /** Opens or closes the group. */
  onToggleExpand: () => void;
  /** Picks or drops every member the current mode can act on. */
  onToggleSelection: () => void;
};

/**
 * Whether a signed image URL is still worth loading.
 *
 * The app has no route to re-sign a kit's image, so an expired URL renders as
 * a broken picture with no way back. Only positive evidence of freshness earns
 * the image: an expiry the parser cannot read counts as expired, because an
 * unreadable timestamp says nothing about whether the signature still holds.
 *
 * No expiry at all is a different answer — the server omits it for URLs that
 * carry no signature, and those never go stale.
 *
 * @param imageExpiration - the URL's expiry, as sent by the server
 * @returns true only while the URL is known to still be fetchable
 */
function isImageStillSigned(imageExpiration: string | null): boolean {
  if (!imageExpiration) return true;
  const expiresAt = Date.parse(imageExpiration);
  return !Number.isNaN(expiresAt) && expiresAt > Date.now();
}

/**
 * The header row of one kit on a booking's asset list.
 *
 * Outside selection the row shows a chevron on the left and a tap opens or
 * closes the kit. Inside selection the row shows a 22 x 22 slot on the left and
 * a chevron on the right that opens or closes the kit. For a kit the current
 * mode can act on, the slot holds a tick box and a tap on the row picks or
 * drops its members. For a kit the mode cannot act on, the slot is empty and a
 * tap on the row opens or closes the kit.
 *
 * @param props - see `BookingKitHeaderProps`
 * @returns the pressable kit header row
 */
export function BookingKitHeader({
  kit,
  name,
  memberCount,
  badge,
  expanded,
  selectionState,
  onToggleExpand,
  onToggleSelection,
}: BookingKitHeaderProps) {
  const { colors, statusBadge, bookingStatusBadge } = useTheme();
  const styles = useStyles();

  const isSelecting = selectionState !== null;
  // True only while selecting AND the mode can act on a member of this kit.
  const isSelectable = isSelecting && selectionState !== "unselectable";
  const showImage =
    Boolean(kit?.image) && isImageStillSigned(kit?.imageExpiration ?? null);

  // "Returned" borrows the colours a member row uses for the same state, so a
  // kit and the assets under it agree on screen. Everything else speaks the
  // shared status vocabulary; a kit whose members are all back reads in the
  // in-custody blue, as it does on the website.
  const badgeColors = badge
    ? badge.tone === "returned"
      ? bookingStatusBadge.COMPLETE
      : badge.tone === "PARTIALLY_CHECKED_IN"
      ? statusBadge.IN_CUSTODY
      : statusBadge[badge.tone]
    : null;

  // A press does one of two things and there is no chevron for a screen reader
  // to look at, so the label ends by naming the one it will do. "Tap to select"
  // is the wording the asset rows use, and a kit header is read out in the same
  // list as the rows under it.
  const pressLabel = isSelectable
    ? selectionState === "all"
      ? "Tap to deselect"
      : "Tap to select"
    : expanded
    ? "Tap to collapse"
    : "Tap to expand";

  const accessibilityLabel = `${[
    `Kit: ${name}`,
    `${memberCount} ${memberCount === 1 ? "asset" : "assets"}`,
    badge ? badge.label : "no status",
    expanded ? "expanded" : "collapsed",
    selectionState === "all"
      ? "selected"
      : selectionState === "some"
      ? "partially selected"
      : selectionState === "unselectable"
      ? "not selectable"
      : null,
  ]
    .filter(Boolean)
    .join(", ")}. ${pressLabel}`;

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.6}
      // The row is never inert: opening a kit is worth doing even when the
      // current mode can select none of its members — that is usually the
      // moment you want to look inside it. Only the SELECTION is unavailable,
      // so the press falls back to expanding rather than the row going
      // `disabled`, which would also take the accessibility action below with
      // it (RN treats a disabled touchable as one inactive element).
      onPress={isSelectable ? onToggleSelection : onToggleExpand}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // The row is one element to a screen reader, so the chevron on the right
      // during selection cannot be reached by swiping. This exposes the same
      // toggle as a rotor action, which is the only route to it.
      accessibilityActions={[
        { name: "expand", label: expanded ? "Collapse kit" : "Expand kit" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "expand") onToggleExpand();
      }}
    >
      {/* During selection the left slot is always 22 x 22, so every kit row
          lines up. Only a kit the mode can act on gets a tick box in it. */}
      {!isSelecting ? (
        <Ionicons
          name={expanded ? "chevron-down" : "chevron-forward"}
          size={18}
          color={colors.muted}
        />
      ) : isSelectable ? (
        <View
          style={[
            styles.checkbox,
            selectionState === "all" && styles.checkboxChecked,
          ]}
        >
          {selectionState === "all" ? (
            <Ionicons
              name="checkmark"
              size={14}
              color={colors.primaryForeground}
            />
          ) : selectionState === "some" ? (
            <Ionicons name="remove" size={14} color={colors.primary} />
          ) : null}
        </View>
      ) : (
        <View style={styles.checkboxSlot} />
      )}

      {showImage ? (
        <Image
          source={{ uri: kit!.image! }}
          style={styles.image}
          contentFit="cover"
        />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]}>
          <Ionicons name="albums-outline" size={18} color={colors.muted} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {memberCount} {memberCount === 1 ? "asset" : "assets"}
          {kit?.category ? ` • ${kit.category.name}` : ""}
        </Text>
        {kit?.location ? (
          <View style={styles.locationRow}>
            <Ionicons
              name="location-outline"
              size={11}
              color={colors.mutedLight}
            />
            <Text style={styles.location} numberOfLines={1}>
              {kit.location.name}
            </Text>
          </View>
        ) : null}
      </View>

      {badge && badgeColors ? (
        <View style={[styles.statusBadge, { backgroundColor: badgeColors.bg }]}>
          {badge.tone === "returned" ? (
            <Ionicons name="checkmark" size={10} color={badgeColors.text} />
          ) : (
            <View
              style={[styles.statusDot, { backgroundColor: badgeColors.text }]}
            />
          )}
          <Text style={[styles.statusText, { color: badgeColors.text }]}>
            {badge.label}
          </Text>
        </View>
      ) : null}

      {isSelecting ? (
        <TouchableOpacity
          onPress={onToggleExpand}
          hitSlop={CONTROL_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} kit ${name}`}
        >
          <Ionicons
            name={expanded ? "chevron-down" : "chevron-forward"}
            size={18}
            color={colors.muted}
          />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const useStyles = createStyles((colors) => ({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.backgroundSecondary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  image: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
  },
  imagePlaceholder: {
    backgroundColor: colors.backgroundTertiary,
    justifyContent: "center",
    alignItems: "center",
  },
  info: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: fontSize.base,
    fontWeight: "700",
    color: colors.foreground,
  },
  meta: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  location: {
    fontSize: fontSize.xs,
    color: colors.mutedLight,
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.pill,
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: "500",
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.gray300,
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  // Holds the tick box's place on a kit the mode cannot act on. The size must
  // match `checkbox`, or the rows stop lining up.
  checkboxSlot: {
    width: 22,
    height: 22,
  },
}));
