/**
 * BookingCalendar — bookings laid out over time, on the phone.
 *
 * Customer request (Richard Raiman, Raiman Production): "calendar view to have
 * a picture of upcomming bookings in the context of weeks / months".
 *
 * The Bookings list already answers "what is coming up" as text. What it cannot
 * show is SHAPE: that one week is packed and the rest of the month is free,
 * which is what a rental operation needs before saying yes to another job. This
 * view exists to give what a list cannot.
 *
 * Bookings are date RANGES, and that is the point — a five-day job must read as
 * one continuous run, not five identical dots. `multi-period` marking draws
 * exactly that, and stacks bands when jobs overlap.
 *
 * Colours come from the same `bookingStatusBadge` map the list rows and the
 * detail screen use, and wording from `@shelf/labels`, so a RESERVED booking
 * looks and reads the same everywhere in the app and on the website.
 *
 * @see {@link file://../../../webapp/app/routes/api+/mobile+/bookings.calendar.ts}
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, ActivityIndicator, TouchableOpacity } from "react-native";
import { Calendar, type DateData } from "react-native-calendars";
import { useRouter } from "expo-router";
import { BOOKING_STATUS_LABELS } from "@shelf/labels";
import { api } from "@/lib/api";
import type { CalendarBooking } from "@/lib/api/types";
import { useTheme } from "@/lib/theme-context";
import { useDateFormatter } from "@/lib/use-date-formatter";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

/** `YYYY-MM-DD` in LOCAL time. Never toISOString here: it shifts the day. */
function toKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Every day key a booking covers, inclusive of both ends. */
function daysCovered(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const keys: string[] = [];
  const cursor = new Date(
    start.getFullYear(),
    start.getMonth(),
    start.getDate()
  );
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  // Bounded, so a reversed or absurd range cannot loop forever.
  while (cursor <= last && keys.length < 400) {
    keys.push(toKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

type Props = {
  /** Active workspace. Nothing is fetched without it. */
  orgId: string | undefined;
};

/** Month calendar with a day panel underneath. */
export function BookingCalendar({ orgId }: Props) {
  const router = useRouter();
  const { colors, bookingStatusBadge } = useTheme();
  const styles = useStyles();
  const { formatDate } = useDateFormatter();

  const [visibleMonth, setVisibleMonth] = useState(() => toKey(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => toKey(new Date()));
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetches the visible month plus a week either side, so a booking that began
   * in the previous month still paints its band into this one.
   */
  const load = useCallback(
    async (monthKey: string) => {
      if (!orgId) return;
      const base = new Date(monthKey);
      const start = new Date(base.getFullYear(), base.getMonth(), 1);
      start.setDate(start.getDate() - 7);
      const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      end.setDate(end.getDate() + 7);

      setIsLoading(true);
      setError(null);
      const res = await api.bookingsCalendar(
        orgId,
        start.toISOString(),
        end.toISOString()
      );
      if (res.error) setError(res.error);
      else if (res.data) setBookings(res.data.bookings);
      setIsLoading(false);
    },
    [orgId]
  );

  useEffect(() => {
    void load(visibleMonth);
  }, [load, visibleMonth]);

  /** Day key -> one band per booking touching that day. */
  const marked = useMemo(() => {
    const acc: Record<
      string,
      { periods: { startingDay: boolean; endingDay: boolean; color: string }[] }
    > = {};

    for (const b of bookings) {
      const keys = daysCovered(b.from, b.to);
      const color = bookingStatusBadge[b.status]?.text ?? colors.primary;
      keys.forEach((key, idx) => {
        if (!acc[key]) acc[key] = { periods: [] };
        acc[key].periods.push({
          startingDay: idx === 0,
          endingDay: idx === keys.length - 1,
          color,
        });
      });
    }
    return acc;
  }, [bookings, bookingStatusBadge, colors.primary]);

  const dayBookings = useMemo(
    () =>
      bookings.filter((b) => daysCovered(b.from, b.to).includes(selectedDay)),
    [bookings, selectedDay]
  );

  return (
    <View style={styles.container}>
      <Calendar
        current={visibleMonth}
        onMonthChange={(m: DateData) => setVisibleMonth(m.dateString)}
        onDayPress={(d: DateData) => setSelectedDay(d.dateString)}
        markingType="multi-period"
        markedDates={marked}
        firstDay={1}
        enableSwipeMonths
        theme={{
          calendarBackground: colors.white,
          dayTextColor: colors.foreground,
          monthTextColor: colors.foreground,
          textSectionTitleColor: colors.muted,
          todayTextColor: colors.primaryText,
          arrowColor: colors.primaryText,
          textDisabledColor: colors.mutedLight,
        }}
        style={styles.calendar}
      />

      <View style={styles.dayPanel}>
        <Text style={styles.dayTitle}>{formatDate(selectedDay)}</Text>

        {isLoading && bookings.length === 0 ? (
          <ActivityIndicator color={colors.primary} />
        ) : error ? (
          <Text style={styles.empty}>{error}</Text>
        ) : dayBookings.length === 0 ? (
          <Text style={styles.empty}>Nothing booked on this day.</Text>
        ) : (
          dayBookings.map((b) => {
            const label =
              BOOKING_STATUS_LABELS[
                b.status as keyof typeof BOOKING_STATUS_LABELS
              ] ?? b.status;
            const badge = bookingStatusBadge[b.status] ?? {
              bg: colors.borderLight,
              text: colors.muted,
            };
            return (
              <TouchableOpacity
                key={b.id}
                style={styles.row}
                onPress={() => router.push(`/bookings/${b.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`${b.name}, ${label}, ${formatDate(
                  b.from
                )} to ${formatDate(b.to)}`}
              >
                <View style={styles.rowMain}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {b.name}
                  </Text>
                  <Text style={styles.rowDates}>
                    {formatDate(b.from)} to {formatDate(b.to)}
                  </Text>
                  {b.custodianName ? (
                    <Text style={styles.rowCustodian}>{b.custodianName}</Text>
                  ) : null}
                </View>
                {/* The same pill shape the rest of the app uses for a status. */}
                <View style={[styles.pill, { backgroundColor: badge.bg }]}>
                  <Text style={[styles.pillText, { color: badge.text }]}>
                    {label}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  container: { flex: 1 },
  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dayPanel: {
    flex: 1,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  dayTitle: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: colors.foregroundSecondary,
  },
  empty: {
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
  rowMain: { flex: 1, gap: 2 },
  rowName: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.foreground,
  },
  rowDates: { fontSize: fontSize.xs, color: colors.muted },
  rowCustodian: { fontSize: fontSize.xs, color: colors.mutedLight },
  pill: {
    borderRadius: borderRadius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  pillText: { fontSize: fontSize.xs, fontWeight: "600" },
}));
