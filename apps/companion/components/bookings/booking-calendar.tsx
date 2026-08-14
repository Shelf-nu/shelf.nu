/**
 * BookingCalendar — bookings laid out over time, on the phone.
 *
 * Asked for by rental operations who need to see upcoming bookings across
 * weeks and months.
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
  calendarMonthWindow as monthWindow,
} from "@shelf/datetime";
import { BOOKING_STATUS_LABELS } from "@shelf/labels";
import { api } from "@/lib/api";
import type { CalendarBooking } from "@/lib/api/types";
import { useTheme } from "@/lib/theme-context";
import { useDateFormatter } from "@/lib/use-date-formatter";
import { createStyles } from "@/lib/create-styles";
import { fontSize, spacing, borderRadius } from "@/lib/constants";

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
   * Raised by the parent when a booking is mutated on another screen. Any
   * change bumps it; the calendar drops its cached months and refetches.
   */
  refreshToken?: number;
  /**
   * Whether this workspace may create bookings. The parent's floating button
   * is hidden in this view, so the action lives in the day panel header.
   */
  canCreate?: boolean;
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

export function BookingCalendar({
  orgId,
  statuses,
  search,
  refreshToken = 0,
  canCreate = false,
}: Props) {
  const router = useRouter();
  const { colors, bookingStatusBadge, isDark } = useTheme();
  const styles = useStyles();
  const { formatDate, prefs } = useDateFormatter();

  // Keys are built in the user's saved zone, not the device's. The rows below
  // print their dates in that zone, so keying by device time marked a booking
  // on one square and printed another date on its row.
  const [visibleMonth, setVisibleMonth] = useState(() =>
    toKey(new Date(), prefs.timeZone)
  );
  const [selectedDay, setSelectedDay] = useState(() =>
    toKey(new Date(), prefs.timeZone)
  );
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

  /**
   * The workspace is part of the request's identity, not just the month and
   * filters. Without it, a request in flight when the user switches workspaces
   * carries the same key as the new one, so the old workspace's response passes
   * the staleness check and repaints the grid with bookings from a workspace
   * the user has left.
   */
  const cacheKey = useCallback(
    (monthKey: string) =>
      `${orgId ?? ""}|${monthKey}|${statuses ?? ""}|${search ?? ""}`,
    [orgId, statuses, search]
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
   * An org switch clears the rows too, not just the cache. Leaving them up
   * meant the previous workspace's bookings stayed on screen until the new
   * response landed, which is the one thing a workspace boundary must never do.
   */
  useEffect(() => {
    setBookings([]);
    setOutside({ count: 0, jumpTo: null });
  }, [orgId]);

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

      const { start, end } = monthWindow(monthKey);

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
   * Keep the selected day inside the month on screen.
   *
   * Paging months left the panel describing a day from the month you left, and
   * because only the visible month's bookings are loaded it answered "Nothing
   * booked on this day" for days that were fully booked. A panel that is
   * confidently wrong is worse than no panel. There was also nothing marked in
   * the grid, so nothing said which day it meant.
   *
   * Lands on today when today is in view, since that is the day a dispatcher
   * wants, and the first of the month otherwise.
   */
  useEffect(() => {
    if (selectedDay.slice(0, 7) === visibleMonth.slice(0, 7)) return;
    const today = toKey(new Date(), prefs.timeZone);
    setSelectedDay(
      today.slice(0, 7) === visibleMonth.slice(0, 7)
        ? today
        : `${visibleMonth.slice(0, 7)}-01`
    );
  }, [visibleMonth, selectedDay, prefs.timeZone]);
  /**
   * A booking changed on another screen - checked out, checked in, cancelled,
   * archived, deleted. Every cached month is suspect, not just this one, since
   * the change could have moved its dates. Drop the cache and refetch what is
   * on screen. Skips the first render, where there is nothing to invalidate.
   */
  const lastRefreshToken = useRef(refreshToken);
  useEffect(() => {
    if (lastRefreshToken.current === refreshToken) return;
    lastRefreshToken.current = refreshToken;
    monthCache.current.clear();
    void load(visibleMonth, { force: true });
  }, [refreshToken, load, visibleMonth]);

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

    const window = monthWindow(visibleMonth);

    for (const b of bookings) {
      // Clipped to the window: a booking can be longer than the enumeration
      // cap, and counting from its own start then produced no keys for the
      // month on screen at all.
      const keys = daysCovered(b.from, b.to, {
        from: window.start,
        to: window.end,
      });
      // The caps still come from the booking's real dates, so a band running
      // in from before the window is drawn open rather than looking like it
      // starts at the edge of the screen.
      const trueStart = toKey(new Date(b.from), prefs.timeZone);
      const trueEnd = toKey(new Date(b.to), prefs.timeZone);
      const color = bookingStatusBadge[b.status]?.text ?? colors.primary;
      keys.forEach((key) => {
        (byDay[key] ??= []).push(b);
        const mark = (marks[key] ??= { periods: [], total: 0 });
        mark.total += 1;
        // Collect every band; the cap is applied after sorting, below.
        mark.periods.push({
          startingDay: key === trueStart,
          endingDay: key === trueEnd,
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
  }, [
    bookings,
    bookingStatusBadge,
    colors.primary,
    visibleMonth,
    prefs.timeZone,
  ]);

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
        /* The account's saved week start, which web's calendar also uses.
           Re-deriving it from the device locale showed the two surfaces
           different week columns for the same account, and ignored anyone who
           had deliberately chosen Saturday. */
        firstDay={prefs.weekStartsOn}
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
            const target = toKey(
              new Date(outside.jumpTo as string),
              prefs.timeZone
            );
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
        {/* why the create action sits here and not in the parent's floating
            button: that button is anchored to the bottom right of the screen,
            which in this view is the middle of the day panel, so it covered the
            status pill on the first row and half of the second. Here it cannot
            collide with anything, and it reads as "add something to this day"
            rather than floating free. */}
        <View style={styles.dayHeader}>
          <Text style={styles.dayTitle}>{formatDate(selectedDay)}</Text>
          {canCreate ? (
            <TouchableOpacity
              style={styles.newBooking}
              onPress={() => router.push("/(tabs)/bookings/new")}
              accessibilityRole="button"
              accessibilityLabel="Create booking"
            >
              <Ionicons name="add" size={16} color={colors.primaryText} />
              <Text style={styles.newBookingText}>New booking</Text>
            </TouchableOpacity>
          ) : null}
        </View>

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
    // Breathing room at the end of the list; the floating create button is
    // hidden in this view, so this no longer has to clear it.
    paddingBottom: spacing.xl,
  },
  dayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  newBooking: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.pill,
    backgroundColor: colors.backgroundTertiary,
  },
  newBookingText: {
    fontSize: fontSize.sm,
    fontWeight: "600",
    color: colors.primaryText,
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
