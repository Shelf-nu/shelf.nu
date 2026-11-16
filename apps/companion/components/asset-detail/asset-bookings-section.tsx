/**
 * Asset Bookings Section
 *
 * The Bookings section of the asset detail screen: "when is this out, and
 * where has it been?", asked while holding the asset. Mirrors the Bookings tab
 * on the web asset page.
 *
 * Collapsed by default and fetched on first expand, so the screen's usual load
 * is unchanged for the visits that never open it. Once open, it re-fetches
 * whenever the screen re-fetches the asset (pull to refresh, a check-out, a
 * custody change), so its statuses never lag the asset card above it.
 *
 * The screen renders it with `key={asset.id}`: every piece of section state
 * belongs to one asset, and a new key starts the next asset from closed.
 *
 * @see {@link file://../../app/(tabs)/assets/[id].tsx} the screen
 * @see {@link file://../../hooks/use-asset-bookings.ts} the loader
 * @see {@link file://../../lib/asset-bookings-view.ts} what it draws
 */
import { BOOKING_STATUS_LABELS } from "@shelf/labels";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAssetBookings } from "@/hooks/use-asset-bookings";
import type { AssetBookingRow, BookingStatus } from "@/lib/api/types";
import {
  buildAssetBookingsView,
  custodianLabel,
} from "@/lib/asset-bookings-view";
import { borderRadius, fontSize, spacing } from "@/lib/constants";
import { createStyles } from "@/lib/create-styles";
import { useTheme } from "@/lib/theme-context";
import { useDateFormatter } from "@/lib/use-date-formatter";
import { pushIntoTab } from "@/lib/navigation";

/** Props for {@link AssetBookingsSection}. */
type AssetBookingsSectionProps = {
  /** The asset on screen */
  assetId: string;
  /** The active workspace */
  orgId: string | undefined;
  /**
   * The screen's current asset payload. A new object means the screen
   * re-fetched the asset, which is the cue to re-fetch an open list.
   */
  assetSnapshot: object;
};

/**
 * A booking's status as a pill, in the `bookingStatusBadge` palette and the
 * `BOOKING_STATUS_LABELS` wording every booking surface in the app uses.
 *
 * @param props.status - The booking's status
 */
function BookingStatusPill({ status }: { status: BookingStatus }) {
  const { colors, bookingStatusBadge } = useTheme();
  const styles = useStyles();
  const badge = bookingStatusBadge[status] ?? {
    bg: colors.borderLight,
    text: colors.muted,
  };

  return (
    <View style={[styles.statusPill, { backgroundColor: badge.bg }]}>
      <Text style={[styles.statusText, { color: badge.text }]}>
        {BOOKING_STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

/**
 * One booking: name, dates with times, custodian and status. Opens the booking.
 *
 * @param props.booking - The row to draw
 */
function BookingRow({ booking }: { booking: AssetBookingRow }) {
  const styles = useStyles();
  const { formatDateTime } = useDateFormatter();
  const custodian = custodianLabel(booking.custodianName);
  const dates = `${formatDateTime(booking.from)} → ${formatDateTime(
    booking.to
  )}`;
  const spokenCustodian = custodian
    ? custodian.isWithheld
      ? ", custodian hidden"
      : `, ${custodian.text}`
    : "";

  return (
    <TouchableOpacity
      style={styles.row}
      // Another tab's nested route: through pushIntoTab, so the bookings list
      // sits under the booking and back works.
      onPress={() =>
        pushIntoTab("/(tabs)/bookings", `/(tabs)/bookings/${booking.id}`)
      }
      accessibilityRole="button"
      accessibilityLabel={`${booking.name}, ${
        BOOKING_STATUS_LABELS[booking.status]
      }, ${formatDateTime(booking.from)} to ${formatDateTime(
        booking.to
      )}${spokenCustodian}`}
    >
      <View style={styles.rowMain}>
        <Text style={styles.name} numberOfLines={1}>
          {booking.name}
        </Text>
        <Text style={styles.dates}>{dates}</Text>
        {custodian ? (
          <Text
            style={[
              styles.custodian,
              custodian.isWithheld && styles.custodianWithheld,
            ]}
          >
            {custodian.text}
          </Text>
        ) : null}
      </View>
      <BookingStatusPill status={booking.status} />
    </TouchableOpacity>
  );
}

/**
 * The collapsible Bookings section for one asset.
 *
 * @param props - See {@link AssetBookingsSectionProps}
 */
export function AssetBookingsSection({
  assetId,
  orgId,
  assetSnapshot,
}: AssetBookingsSectionProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const assetBookings = useAssetBookings(assetId, orgId);
  const [isOpen, setIsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { hasLoaded, load } = assetBookings;
  const lastSnapshot = useRef(assetSnapshot);
  useEffect(() => {
    if (lastSnapshot.current === assetSnapshot) return;
    lastSnapshot.current = assetSnapshot;
    // A closed section re-fetches on its next expand instead.
    if (isOpen && hasLoaded) void load();
  }, [assetSnapshot, isOpen, hasLoaded, load]);

  const view = buildAssetBookingsView({
    bookings: assetBookings.bookings,
    activeBookings: assetBookings.activeBookings,
    totalCount: assetBookings.totalCount,
    showAll,
  });

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    // Every expand loads, so a reopened section is never older than the asset.
    if (next) void load();
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={
          isOpen ? "Hide bookings" : "Show bookings for this asset"
        }
      >
        <Text style={styles.title}>Bookings</Text>
        <View style={styles.headerRight}>
          {hasLoaded && (
            <Text style={styles.count}>{assetBookings.totalCount}</Text>
          )}
          <Ionicons
            name={isOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.muted}
          />
        </View>
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.body}>
          {!hasLoaded ? (
            assetBookings.error ? (
              <Text style={styles.note}>{assetBookings.error}</Text>
            ) : (
              <ActivityIndicator color={colors.primary} />
            )
          ) : view.rows.length === 0 ? (
            <Text style={styles.note}>This asset has never been booked.</Text>
          ) : (
            view.rows.map((b) => <BookingRow key={b.id} booking={b} />)
          )}

          {hasLoaded && assetBookings.error ? (
            // A failed refresh keeps the rows it had, and says they may be old.
            <Text style={styles.note}>
              {`Could not refresh: ${assetBookings.error}`}
            </Text>
          ) : null}

          {view.hiddenCount > 0 ? (
            <TouchableOpacity
              style={styles.more}
              onPress={() => setShowAll(true)}
              accessibilityRole="button"
              accessibilityLabel={`Show ${view.hiddenCount} older bookings`}
            >
              <Text style={styles.moreText}>
                {`Show ${view.hiddenCount} older`}
              </Text>
            </TouchableOpacity>
          ) : null}

          {hasLoaded && view.isTruncated ? (
            <Text style={styles.note}>
              {`Showing ${view.loadedCount} of ${assetBookings.totalCount}. Open this asset on the web app to see them all.`}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  container: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  title: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.muted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  count: {
    fontSize: fontSize.xs,
    fontWeight: "600",
    color: colors.foregroundSecondary,
    backgroundColor: colors.backgroundTertiary,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: "hidden",
  },
  body: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  note: {
    fontSize: fontSize.sm,
    color: colors.muted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  dates: {
    fontSize: fontSize.xs,
    color: colors.muted,
  },
  custodian: {
    fontSize: fontSize.xs,
    // why: NOT `mutedLight`. That token is for icons and large text (4.35:1
    // light, 3.77:1 dark) and misses 4.5:1 at this 12px size. `muted` still
    // reads quieter than the dates line above it and clears the bar in both
    // themes.
    color: colors.muted,
  },
  // A placeholder, not a person's name: set apart by style, same contrast.
  custodianWithheld: {
    fontStyle: "italic",
  },
  more: {
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  moreText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.primaryText,
  },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.pill,
  },
  statusText: {
    fontSize: fontSize.xs,
    fontWeight: "600",
  },
}));
