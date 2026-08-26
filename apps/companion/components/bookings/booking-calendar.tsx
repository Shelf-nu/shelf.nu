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
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
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
import {
  Calendar,
  type CalendarProps,
  type DateData,
} from "react-native-calendars";
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

/**
 * Exactly the props react-native-calendars hands a custom day component.
 *
 * why derived rather than hand-written: `dayComponent` used to take `any`, and
 * with no contract nothing checked that our `onPress` was shadowing the
 * library's own handler, nor that the marking we passed matched what a cell can
 * receive. Both were live defects a real type would have caught at compile time.
 */
type CalendarDayProps = ComponentProps<
  NonNullable<CalendarProps["dayComponent"]>
>;

/**
 * One band, in the shape the library's `periods` marking uses. The flags are
 * optional here for the same reason they are optional there: a band running in
 * from outside the window has neither cap.
 */
type BookingBand = {
  color: string;
  startingDay?: boolean;
  endingDay?: boolean;
};

/**
 * What our `markedDates` payload carries into the custom cell: the library's
 * band list, plus the TOTAL touching that day. The library has no field for
 * that total and the cell needs it to print an honest "+N".
 */
type DayMarking = {
  periods?: BookingBand[];
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
}: Omit<CalendarDayProps, "marking"> & {
  marking?: DayMarking;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const periods = marking?.periods ?? [];
  const hidden = Math.max(0, (marking?.total ?? 0) - periods.length);
  const isSelected = marking?.selected === true;
  const isToday = state === "today";

  return (
    <TouchableOpacity
      style={dayStyles.cell}
      /**
       * The LIBRARY's press handler, not our own.
       *
       * why: overriding it meant a tap on one of the greyed adjacent-month days
       * the grid still renders set the selected day to a date in another month,
       * and the month-sync effect below immediately overwrote it - so an
       * obviously tappable square either did nothing or jumped to the 1st. The
       * library's handler navigates to that day's month first and then calls
       * `onDayPress`, which is what a tapper is asking for.
       */
      onPress={() => onPress?.(date)}
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
        {/* Already sorted and capped where `total` is counted, so the "+N"
            below and what is drawn here can never disagree. */}
        {periods.map((p, i) => (
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
  /** The server had more for this window than it would send. */
  truncated: boolean;
};

/** No month loaded: what an org switch resets to, and the initial value. */
const EMPTY_MONTH: CachedMonth = {
  bookings: [],
  outside: { count: 0, jumpTo: null },
  truncated: false,
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
  /**
   * One month's answer, held as ONE piece of state.
   *
   * why not three: these always move together - the cache stores them as a unit
   * (`CachedMonth`), `load` sets them as a unit, and an org switch clears them
   * as a unit. Split across three `useState`s, every one of those was a cascade
   * of three sets where one will do, and nothing in the types said they belong
   * together. `truncated` is here for the same reason the other two are: rows
   * arrive soonest first, so a window we could not answer in full is missing
   * its END, which would draw as empty days and read as "nothing booked"
   * rather than "not shown".
   */
  const [month, setMonth] = useState<CachedMonth>(EMPTY_MONTH);
  const { bookings, outside, truncated } = month;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The month being shown, as its first day.
   *
   * why anchor it: the library preserves the day-of-month across swipes and
   * clamps it at month ends, and the "jump to the next booking" row sets a
   * specific date. Both produce different day keys for the SAME month, which
   * request the same window - so keying work off the raw value refetched a
   * month already in hand and re-ran the whole marking pass for nothing.
   */
  const monthAnchor = `${visibleMonth.slice(0, 7)}-01`;

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
    // Sliced to the MONTH: two day keys inside one month describe the same
    // window, so keying on the full key made them miss each other in the cache.
    (monthKey: string) =>
      `${orgId ?? ""}|${monthKey.slice(0, 7)}|${statuses ?? ""}|${
        search ?? ""
      }`,
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
    setMonth(EMPTY_MONTH);
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

      // What the cache holds for this month, and what we are willing to paint
      // from it. A forced refresh bypasses the second without discarding the
      // first, so a failed refresh can still fall back on it below.
      const held = monthCache.current.get(key);
      const cached = options.force ? undefined : held;
      if (cached) {
        // Paint what we have, then confirm it below. The month is already
        // correct in the common case, so the grid does not blink.
        setMonth(cached);
      } else {
        setIsLoading(true);
      }

      // The account's week start, so the window is exactly the weeks the grid
      // draws. Anything wider fetches days that have no square to paint on.
      const { start, end } = monthWindow(monthKey, prefs.weekStartsOn);

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
        // A month already on screen stays there rather than being replaced by
        // an error for data we have. That covers a failed forced refresh too,
        // which bypasses the cache without invalidating it.
        if (!cached) {
          setError(res.error);
          // Blank the grid only with nothing correct for THIS month to show:
          // `month` still holds the month we came FROM, and leaving it would
          // re-clip those bookings into the new month's squares and count them
          // in "N more outside this month".
          if (held) setMonth(held);
          else setMonth(EMPTY_MONTH);
        }
      } else if (res.data) {
        const next: CachedMonth = {
          bookings: res.data.bookings,
          outside: res.data.outsideWindow ?? { count: 0, jumpTo: null },
          truncated: res.data.truncated === true,
        };
        monthCache.current.set(key, next);
        setMonth(next);
      }
      setIsLoading(false);
    },
    [orgId, statuses, search, cacheKey, prefs.weekStartsOn]
  );

  // Anchored to the month, so selecting a different day inside the month on
  // screen does not re-request a window we already have.
  useEffect(() => {
    void load(monthAnchor);
  }, [load, monthAnchor]);

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
    void load(monthAnchor, { force: true });
  }, [refreshToken, load, monthAnchor]);

  /**
   * Single pass over the bookings, producing both the day marks and a
   * day -> bookings index.
   *
   * why one pass: the day panel used to re-derive every booking's covered days
   * on every tap. On a busy month that is the same work repeated for each poke
   * at the grid, and this screen is poked at constantly.
   */
  const { marks, byDay, undrawn } = useMemo(() => {
    /** Bands while they are still sortable; `priority` is dropped on the way out. */
    const ranked: Record<
      string,
      {
        periods: (BookingBand & { priority: number })[];
        /** EVERY booking touching the day, not just the bands we draw. */
        total: number;
      }
    > = {};
    const byDay: Record<string, CalendarBooking[]> = {};
    /**
     * Fetched, but covering no square this grid draws.
     *
     * The window is built from the DEVICE's midnight while days are keyed in the
     * account's saved zone, so when those differ the two disagree by up to a
     * day at each edge. That is a far narrower fringe than the flat week this
     * replaced, but a booking landing in it would still be drawn nowhere while
     * counting as inside the window - invisible, with nothing to explain it.
     * Folding them into the "outside this month" line closes it exactly,
     * whatever the two zones are.
     */
    const undrawn: CalendarBooking[] = [];

    const window = monthWindow(monthAnchor, prefs.weekStartsOn);

    for (const b of bookings) {
      /**
       * Clipped to the window: a booking can be longer than the enumeration
       * cap, and counting from its own start then produced no keys for the
       * month on screen at all.
       *
       * In the account's SAVED zone, which is not always the device's. Keying
       * by device time filed a booking under one square while `trueStart` /
       * `trueEnd` and the row beneath printed another date - so the band lost
       * its caps, and the day the row named answered "Nothing booked".
       */
      const keys = daysCovered(
        b.from,
        b.to,
        { from: window.start, to: window.end },
        prefs.timeZone
      );
      if (keys.length === 0) {
        undrawn.push(b);
        continue;
      }
      // The caps still come from the booking's real dates, so a band running
      // in from before the window is drawn open rather than looking like it
      // starts at the edge of the screen.
      const trueStart = toKey(new Date(b.from), prefs.timeZone);
      const trueEnd = toKey(new Date(b.to), prefs.timeZone);
      const color = bookingStatusBadge[b.status]?.text ?? colors.primary;
      keys.forEach((key) => {
        (byDay[key] ??= []).push(b);
        const mark = (ranked[key] ??= { periods: [], total: 0 });
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
    /**
     * Most urgent first, then cap - the ONLY place the cap is applied, so the
     * cell can draw what it is given and its "+N" can never disagree with it.
     * `total` still counts everything, so that "+N" stays truthful.
     */
    const marks: Record<string, DayMarking> = {};
    for (const [key, mark] of Object.entries(ranked)) {
      marks[key] = {
        total: mark.total,
        periods: mark.periods
          .sort((a, b) => a.priority - b.priority)
          .slice(0, MAX_BANDS_PER_DAY)
          // `priority` is ours, for ordering only; the library's marking has no
          // such field and the cell has no use for it.
          .map(({ color, startingDay, endingDay }) => ({
            color,
            startingDay,
            endingDay,
          })),
      };
    }
    // The day panel reads the same way: what needs attention at the top.
    for (const list of Object.values(byDay)) {
      list.sort(
        (a, b) =>
          (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
      );
    }

    return { marks, byDay, undrawn };
  }, [
    bookings,
    bookingStatusBadge,
    colors.primary,
    monthAnchor,
    prefs.timeZone,
    prefs.weekStartsOn,
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

  /**
   * What this grid does not show, from both directions: the server's count of
   * everything outside the window it was asked for, plus anything it did send
   * that landed on no square. `jumpTo` prefers the server's answer and falls
   * back to the earliest undrawn booking, which arrives soonest-first.
   */
  const outsideCount = outside.count + undrawn.length;
  const outsideJumpTo = outside.jumpTo ?? undrawn[0]?.from ?? null;

  /**
   * Stable identity, and it has to be.
   *
   * react-native-calendars does `const Component = dayComponent` and then
   * renders `<Component/>`, so a new arrow on every render is a new component
   * TYPE - React unmounts and remounts all ~42 cells, defeating both the
   * library's `React.memo` on the day and our own on the cell. Every tap, every
   * loading flip and every search keystroke rebuilt the whole grid.
   */
  const renderDay = useCallback(
    (dayProps: CalendarDayProps) => <DayCell {...dayProps} colors={colors} />,
    [colors]
  );

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
        dayComponent={renderDay}
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

      {/* why: rows come back soonest first, so a window we could not answer in
          full is missing its END. Those days would draw as empty, which on a
          calendar reads as "free" — the one thing this view must never say
          about a day that is booked. */}
      {truncated ? (
        <View style={styles.truncatedRow}>
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={colors.warningText}
          />
          <Text style={styles.truncatedText}>
            This month has more bookings than can be shown. Narrow the filters
            to see the rest.
          </Text>
        </View>
      ) : null}

      {/* why: the bookings list is date-blind — "Active" shows every open
          booking whenever it falls — while this grid shows one month. Without
          this line you switch lens and four bookings simply vanish, with
          nothing saying they are in March. */}
      {outsideCount > 0 && outsideJumpTo ? (
        <TouchableOpacity
          style={styles.outsideRow}
          onPress={() => {
            const target = toKey(new Date(outsideJumpTo), prefs.timeZone);
            setVisibleMonth(target);
            setSelectedDay(target);
          }}
          accessibilityRole="button"
          accessibilityLabel={`${outsideCount} more bookings outside this month. Jump to ${formatDate(
            outsideJumpTo
          )}`}
        >
          <Ionicons
            name="arrow-forward-circle-outline"
            size={16}
            color={colors.primaryText}
          />
          <Text style={styles.outsideText}>
            {outsideCount} more outside this month
          </Text>
          <Text style={styles.outsideJump}>{formatDate(outsideJumpTo)}</Text>
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
              onPress={() =>
                router.push({
                  pathname: "/(tabs)/bookings/new",
                  params: { day: selectedDay },
                })
              }
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
  /** Same shape as the "outside this month" row, in the warning palette. */
  truncatedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warningBg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  truncatedText: {
    flex: 1,
    // warningText, not `warning`: this is small body copy, which needs the
    // 4.5:1 shade rather than the badge fill.
    color: colors.warningText,
    fontSize: fontSize.xs,
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
