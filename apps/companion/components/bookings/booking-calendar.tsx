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

/**
 * Regions that start the week on Sunday. Used only when the JS engine cannot
 * answer for itself: Hermes ships a reduced Intl and may not carry `weekInfo`.
 */
const SUNDAY_FIRST = new Set([
  "US",
  "CA",
  "MX",
  "BR",
  "CO",
  "PE",
  "VE",
  "AR",
  "CL",
  "JP",
  "KR",
  "TW",
  "CN",
  "HK",
  "IL",
  "IN",
  "ID",
  "PH",
  "TH",
  "ZA",
]);

/**
 * First day of the week for this device, as react-native-calendars wants it
 * (0 = Sunday, 1 = Monday).
 *
 * why: this was hardcoded to Monday, which is simply wrong for every customer
 * in the US and much of Asia — the calendar would silently show them a week
 * shape they do not use.
 */
function resolveFirstDay(): number {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const info = (
      new Intl.Locale(locale) as unknown as {
        weekInfo?: { firstDay?: number };
      }
    ).weekInfo;
    // Intl counts 1 = Monday ... 7 = Sunday; the calendar wants 0 for Sunday.
    if (info?.firstDay) return info.firstDay === 7 ? 0 : info.firstDay;
    const region = locale.split("-").pop()?.toUpperCase() ?? "";
    return SUNDAY_FIRST.has(region) ? 0 : 1;
  } catch {
    return 1;
  }
}

/**
 * Most bands we will stack in one day cell. Beyond this the cell stops being
 * readable and starts pushing the row height around; the day panel below is
 * where the full list lives anyway.
 */
const MAX_BANDS_PER_DAY = 3;

type Props = {
  /** Active workspace. Nothing is fetched without it. */
  orgId: string | undefined;
  /**
   * Comma-joined statuses from the pills above, so the lens and the filter
   * compose: the switch decides HOW you look, the pills decide WHAT at.
   * Without this a filter set in list mode was silently dropped on switching.
   */
  statuses?: string;
  /** Same keyword search the list uses. Web filters its calendar too. */
  search?: string;
};

/** Month calendar with a day panel underneath. */
export function BookingCalendar({ orgId, statuses, search }: Props) {
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
        end.toISOString(),
        { statuses, search }
      );
      if (res.error) setError(res.error);
      else if (res.data) setBookings(res.data.bookings);
      setIsLoading(false);
    },
    [orgId, statuses, search]
  );

  useEffect(() => {
    void load(visibleMonth);
  }, [load, visibleMonth]);

  /**
   * Single pass over the bookings, producing both the day marks and a
   * day -> bookings index.
   *
   * why one pass: the day panel used to re-derive every booking's covered days
   * on every tap. On a busy month that is the same work repeated for each poke
   * at the grid, and this screen is poked at constantly.
   */
  const { marks, byDay } = useMemo(() => {
    const marks: Record<
      string,
      { periods: { startingDay: boolean; endingDay: boolean; color: string }[] }
    > = {};
    const byDay: Record<string, CalendarBooking[]> = {};

    for (const b of bookings) {
      const keys = daysCovered(b.from, b.to);
      const color = bookingStatusBadge[b.status]?.text ?? colors.primary;
      keys.forEach((key, idx) => {
        (byDay[key] ??= []).push(b);
        const mark = (marks[key] ??= { periods: [] });
        // Cap the stack: more than a few bands in one cell is unreadable.
        if (mark.periods.length < MAX_BANDS_PER_DAY) {
          mark.periods.push({
            startingDay: idx === 0,
            endingDay: idx === keys.length - 1,
            color,
          });
        }
      });
    }
    return { marks, byDay };
  }, [bookings, bookingStatusBadge, colors.primary]);

  /**
   * Marks plus the selected day.
   *
   * why at all: without a selected mark you tap a day, the panel below
   * changes, and the grid tells you nothing about which day you are reading.
   * The colours for it must be named in the theme, or the library falls back
   * to its own blue.
   */
  const markedDates = useMemo(
    () => ({
      ...marks,
      [selectedDay]: {
        ...(marks[selectedDay] ?? { periods: [] }),
        selected: true,
      },
    }),
    [marks, selectedDay, colors.primary]
  );

  const dayBookings = byDay[selectedDay] ?? [];

  return (
    <View style={styles.container}>
      <Calendar
        current={visibleMonth}
        onMonthChange={(m: DateData) => setVisibleMonth(m.dateString)}
        onDayPress={(d: DateData) => setSelectedDay(d.dateString)}
        markingType="multi-period"
        markedDates={markedDates}
        firstDay={resolveFirstDay()}
        enableSwipeMonths
        theme={{
          calendarBackground: colors.white,
          dayTextColor: colors.foreground,
          monthTextColor: colors.foreground,
          textSectionTitleColor: colors.muted,
          todayTextColor: colors.primaryText,
          // why: without these the library paints the selected day its own
          // default blue (#00adf5), which is nothing to do with our palette.
          selectedDayBackgroundColor: colors.primary,
          selectedDayTextColor: colors.primaryForeground,
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
