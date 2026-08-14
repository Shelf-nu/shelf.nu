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
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Calendar, type DateData } from "react-native-calendars";
import { useRouter } from "expo-router";
import {
  calendarDayKey as toKey,
  calendarDaysCovered as daysCovered,
} from "@shelf/datetime";
import { BOOKING_STATUS_LABELS } from "@shelf/labels";
import { api } from "@/lib/api";
import type { CalendarBooking } from "@/lib/api/types";
import { useTheme } from "@/lib/theme-context";
import { useDateFormatter } from "@/lib/use-date-formatter";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

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

/**
 * Which statuses earn one of the few bands a cell can show.
 *
 * why: bands used to be kept in start-date order, so a day holding three long
 * reserved runs and one overdue job showed three calm blue bars and hid the
 * overdue behind "+1". The grid is read to judge risk, so when it must hide
 * something it has to hide the routine thing, never the alarming one.
 */
const STATUS_PRIORITY: Record<string, number> = {
  OVERDUE: 0,
  ONGOING: 1,
  RESERVED: 2,
  DRAFT: 3,
  COMPLETE: 4,
};

/** What our `markedDates` payload carries into the custom cell. */
type DayMarking = {
  periods?: { startingDay: boolean; endingDay: boolean; color: string }[];
  total?: number;
  selected?: boolean;
};

/**
 * One day cell.
 *
 * why custom rather than the library's `multi-period` rendering: that draws the
 * bands but has nowhere to say how many it did NOT draw. Under real load — a
 * rental day with seven overlapping jobs — the cell showed three bands and
 * looked like a quiet day. A calendar whose whole purpose is judging capacity
 * must not under-report it, so the cell now carries a "+N" when it is holding
 * back.
 *
 * Bands still read as continuous runs across days: each covered day paints a
 * full-width bar, and only the true start and end get a rounded cap, so
 * adjacent cells join up.
 */
const DayCell = memo(function DayCell({
  date,
  state,
  marking,
  onPress,
  colors,
  maxBands,
}: {
  date?: { dateString: string; day: number };
  state?: string;
  marking?: DayMarking;
  onPress: (dateString: string) => void;
  colors: ReturnType<typeof useTheme>["colors"];
  maxBands: number;
}) {
  const periods = marking?.periods ?? [];
  const hidden = Math.max(0, (marking?.total ?? 0) - periods.length);
  const isSelected = marking?.selected === true;
  const isToday = state === "today";

  return (
    <TouchableOpacity
      style={dayStyles.cell}
      onPress={() => date && onPress(date.dateString)}
      accessibilityRole="button"
      accessibilityLabel={
        date
          ? `${date.day}${
              marking?.total
                ? `, ${marking.total} booking${marking.total === 1 ? "" : "s"}`
                : ", no bookings"
            }`
          : undefined
      }
      accessibilityState={{ selected: isSelected }}
    >
      <View
        style={[
          dayStyles.numberWrap,
          isSelected && { backgroundColor: colors.primary },
        ]}
      >
        <Text
          style={[
            dayStyles.number,
            {
              color:
                state === "disabled" ? colors.mutedLight : colors.foreground,
            },
            isToday &&
              !isSelected && { color: colors.primaryText, fontWeight: "700" },
            isSelected && {
              color: colors.primaryForeground,
              fontWeight: "700",
            },
          ]}
        >
          {date?.day}
        </Text>
      </View>

      <View style={dayStyles.bands}>
        {periods.slice(0, maxBands).map((p, i) => (
          <View
            key={i}
            style={[
              dayStyles.band,
              { backgroundColor: p.color },
              p.startingDay && dayStyles.bandStart,
              p.endingDay && dayStyles.bandEnd,
            ]}
          />
        ))}
        {hidden > 0 ? (
          <Text style={[dayStyles.more, { color: colors.muted }]}>
            +{hidden}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

const dayStyles = StyleSheet.create({
  cell: { width: "100%", alignItems: "center", paddingBottom: 2 },
  numberWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  number: { fontSize: 15 },
  // Full width so neighbouring days visually join into one run.
  bands: { width: "100%", gap: 2, marginTop: 1, minHeight: 14 },
  band: { height: 3, width: "100%" },
  bandStart: { borderTopLeftRadius: 2, borderBottomLeftRadius: 2 },
  bandEnd: { borderTopRightRadius: 2, borderBottomRightRadius: 2 },
  more: { fontSize: 9, fontWeight: "700", textAlign: "center" },
});

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
type CachedMonth = {
  bookings: CalendarBooking[];
  outside: { count: number; jumpTo: string | null };
};

export function BookingCalendar({ orgId, statuses, search }: Props) {
  const router = useRouter();
  const { colors, bookingStatusBadge, isDark } = useTheme();
  const styles = useStyles();
  const { formatDate } = useDateFormatter();

  const [visibleMonth, setVisibleMonth] = useState(() => toKey(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => toKey(new Date()));
  const [bookings, setBookings] = useState<CalendarBooking[]>([]);
  const [outside, setOutside] = useState<{
    count: number;
    jumpTo: string | null;
  }>({ count: 0, jumpTo: null });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Months already fetched, so paging back and forth does not refetch what we
   * just had. Keyed by month AND filters, because the same month holds a
   * different answer once a status pill or the search box changes.
   *
   * A ref, not state: writing to it must never re-render, and the entries are
   * read inside the fetch rather than during paint.
   */
  const monthCache = useRef(new Map<string, CachedMonth>());

  /**
   * The request the user is actually waiting for. Paging quickly fires several
   * fetches, and they do not come back in order - without this, a slow answer
   * for a month you have already left overwrites the one you are looking at.
   */
  const pendingKey = useRef<string>("");

  const cacheKey = useCallback(
    (monthKey: string) => `${monthKey}|${statuses ?? ""}|${search ?? ""}`,
    [statuses, search]
  );

  /**
   * The cache holds one workspace's bookings, so it cannot survive an org
   * switch or a filter change: the first would show another workspace's
   * bookings, the second would show rows the filter excludes.
   */
  useEffect(() => {
    monthCache.current.clear();
  }, [orgId, statuses, search]);

  /**
   * Fetches the visible month plus a week either side, so a booking that began
   * in the previous month still paints its band into this one.
   */
  const load = useCallback(
    async (monthKey: string, options: { force?: boolean } = {}) => {
      if (!orgId) return;

      const key = cacheKey(monthKey);
      pendingKey.current = key;

      const cached = options.force ? undefined : monthCache.current.get(key);
      if (cached) {
        // Paint what we have, then confirm it below. The month is already
        // correct in the common case, so the grid does not blink.
        setBookings(cached.bookings);
        setOutside(cached.outside);
        setError(null);
      } else {
        setIsLoading(true);
      }

      const base = new Date(monthKey);
      const start = new Date(base.getFullYear(), base.getMonth(), 1);
      start.setDate(start.getDate() - 7);
      const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      end.setDate(end.getDate() + 7);

      setError(null);
      const res = await api.bookingsCalendar(
        orgId,
        start.toISOString(),
        end.toISOString(),
        { statuses, search }
      );

      // Dropped on purpose: the user has moved on, and this answer describes a
      // month they are no longer looking at.
      if (pendingKey.current !== key) return;

      if (res.error) {
        // A cached month stays on screen rather than being replaced by an
        // error for data we already have.
        if (!cached) setError(res.error);
      } else if (res.data) {
        const next = {
          bookings: res.data.bookings,
          outside: res.data.outsideWindow ?? { count: 0, jumpTo: null },
        };
        monthCache.current.set(key, next);
        setBookings(next.bookings);
        setOutside(next.outside);
      }
      setIsLoading(false);
    },
    [orgId, statuses, search, cacheKey]
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
      {
        periods: {
          startingDay: boolean;
          endingDay: boolean;
          color: string;
          priority: number;
        }[];
        /** EVERY booking touching the day, not just the bands we draw. */
        total: number;
      }
    > = {};
    const byDay: Record<string, CalendarBooking[]> = {};

    for (const b of bookings) {
      const keys = daysCovered(b.from, b.to);
      const color = bookingStatusBadge[b.status]?.text ?? colors.primary;
      keys.forEach((key, idx) => {
        (byDay[key] ??= []).push(b);
        const mark = (marks[key] ??= { periods: [], total: 0 });
        mark.total += 1;
        // Collect every band; the cap is applied after sorting, below.
        mark.periods.push({
          startingDay: idx === 0,
          endingDay: idx === keys.length - 1,
          color,
          priority: STATUS_PRIORITY[b.status] ?? 9,
        });
      });
    }
    // Most urgent first, then cap. `total` still counts everything, so the
    // cell's "+N" stays truthful about what it is not showing.
    for (const mark of Object.values(marks)) {
      mark.periods.sort((a, b) => a.priority - b.priority);
      mark.periods = mark.periods.slice(0, MAX_BANDS_PER_DAY);
    }
    // The day panel reads the same way: what needs attention at the top.
    for (const list of Object.values(byDay)) {
      list.sort(
        (a, b) =>
          (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
      );
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
        ...(marks[selectedDay] ?? { periods: [], total: 0 }),
        selected: true,
      },
    }),
    [marks, selectedDay]
  );

  const dayBookings = byDay[selectedDay] ?? [];

  return (
    <View style={styles.container}>
      <Calendar
        // why initialDate and not current: the library reads `current` once, at
        // mount, and thereafter only watches `initialDate`. With `current` a
        // programmatic jump moved the DATA but left the grid showing the old
        // month, so the header said August while the panel listed September.
        initialDate={visibleMonth}
        onMonthChange={(m: DateData) => setVisibleMonth(m.dateString)}
        onDayPress={(d: DateData) => setSelectedDay(d.dateString)}
        markedDates={markedDates}
        dayComponent={(dayProps: any) => (
          <DayCell
            {...dayProps}
            colors={colors}
            maxBands={MAX_BANDS_PER_DAY}
            onPress={setSelectedDay}
          />
        )}
        firstDay={resolveFirstDay()}
        enableSwipeMonths
        /**
         * why the key: react-native-calendars computes its stylesheet once and
         * caches it, so handing it a new `theme` object on a light/dark switch
         * changes nothing - the grid stayed white inside a dark app. Remounting
         * on the switch is the cheap fix; it happens once, when the user changes
         * appearance, and never during normal use.
         */
        key={isDark ? "cal-dark" : "cal-light"}
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

      {/* why: the bookings list is date-blind — "Active" shows every open
          booking whenever it falls — while this grid shows one month. Without
          this line you switch lens and four bookings simply vanish, with
          nothing saying they are in March. */}
      {outside.count > 0 && outside.jumpTo ? (
        <TouchableOpacity
          style={styles.outsideRow}
          onPress={() => {
            const target = toKey(new Date(outside.jumpTo as string));
            setVisibleMonth(target);
            setSelectedDay(target);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${
            outside.count
          } more bookings outside this month. Jump to ${formatDate(
            outside.jumpTo
          )}`}
        >
          <Ionicons
            name="arrow-forward-circle-outline"
            size={16}
            color={colors.primaryText}
          />
          <Text style={styles.outsideText}>
            {outside.count} more outside this month
          </Text>
          <Text style={styles.outsideJump}>{formatDate(outside.jumpTo)}</Text>
        </TouchableOpacity>
      ) : null}

      {/* why a ScrollView: a busy day can hold a dozen bookings. As a plain
          View only the first one and a half were reachable, which is precisely
          the day a dispatcher most needs to read. The bottom padding clears
          the floating create button, which was sitting on top of the rows. */}
      <ScrollView
        style={styles.dayPanel}
        contentContainerStyle={styles.dayPanelContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          /* why: the calendar only refetched when the month changed, so a
             booking made anywhere else — the web app, a colleague's phone —
             stayed invisible until you swiped away and back. The list has
             pull to refresh; this had no way at all. */
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => void load(visibleMonth, { force: true })}
            tintColor={colors.muted}
          />
        }
      >
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
      </ScrollView>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  container: { flex: 1 },
  calendar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  outsideRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.primaryBg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  outsideText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.foregroundSecondary,
  },
  outsideJump: {
    fontSize: fontSize.sm,
    fontWeight: "700",
    color: colors.primaryText,
  },
  dayPanel: {
    flex: 1,
  },
  dayPanelContent: {
    padding: spacing.lg,
    gap: spacing.sm,
    // Clears the floating create button so the last row is readable.
    paddingBottom: 96,
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
