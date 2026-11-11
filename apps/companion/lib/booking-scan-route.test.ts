/**
 * Tests for the booking scanner's route and the plain Scan tab.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths. The screens
 * themselves cannot mount here, so the last group reads their source: the Scan
 * tab must read no route params, and no screen may open the tab with a booking.
 *
 * @see ./booking-scan-route.ts
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  BOOKING_DETAIL_ROUTE_NAME,
  BOOKING_SCAN_PATHNAME,
  bookingScanHref,
  bookingScanLeaveDecision,
  parseBookingScanParams,
  sitsOnItsBooking,
  type BookingScanAction,
  type StackRoute,
} from "./booking-scan-route";

const APP_DIR = join(__dirname, "..", "app");

/** The `app/` route file a route pattern resolves to. */
function routeFile(pattern: string) {
  const path = pattern.replace(/^\//, "");
  return join(APP_DIR, `${path}.tsx`);
}

/** Every `.ts`/`.tsx` source file under a folder, test files excluded. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const ACTIONS: BookingScanAction[] = ["checkin", "checkout", "add", "fulfil"];

test("the booking scanner is a screen in the Bookings stack, not the Scan tab", () => {
  assert.equal(BOOKING_SCAN_PATHNAME, "/(tabs)/bookings/scan");
  assert.ok(existsSync(routeFile(BOOKING_SCAN_PATHNAME)));
});

test("bookingScanHref carries the booking id and flow, never a name", () => {
  for (const action of ACTIONS) {
    const href = bookingScanHref({ id: "bk_1" }, action);
    assert.deepEqual(href, {
      pathname: "/(tabs)/bookings/scan",
      params: {
        bookingId: "bk_1",
        bookingAction: action,
      },
    });
  }
});

test("every flow round-trips through the route params", () => {
  for (const action of ACTIONS) {
    const { params } = bookingScanHref({ id: "bk_1" }, action);
    assert.deepEqual(parseBookingScanParams(params), {
      bookingId: "bk_1",
      action,
    });
  }
});

test("no booking id means no booking context", () => {
  assert.equal(parseBookingScanParams({}), null);
  assert.equal(parseBookingScanParams({ bookingId: "" }), null);
  assert.equal(parseBookingScanParams({ bookingId: "  " }), null);
  assert.equal(parseBookingScanParams({ bookingAction: "add" }), null);
});

test("a missing or unknown action is a check-in", () => {
  assert.equal(
    parseBookingScanParams({ bookingId: "bk_1" })?.action,
    "checkin"
  );
  assert.equal(
    parseBookingScanParams({ bookingId: "bk_1", bookingAction: "delete" })
      ?.action,
    "checkin"
  );
});

test("repeated params take the first value", () => {
  assert.deepEqual(
    parseBookingScanParams({
      bookingId: ["bk_1", "bk_2"],
      bookingAction: ["add", "checkout"],
    }),
    { bookingId: "bk_1", action: "add" }
  );
});

test("the Scan tab reads no route params, so it is always the plain scanner", () => {
  const source = readFileSync(routeFile("/(tabs)/scanner"), "utf8");
  assert.doesNotMatch(source, /useLocalSearchParams|useGlobalSearchParams/);
});

test("no screen opens the Scan tab with a booking", () => {
  const offenders = sourceFiles(APP_DIR)
    .concat(sourceFiles(join(APP_DIR, "..", "lib")))
    .filter((file) => /\/\(tabs\)\/scanner\?/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

test("the booking screen opens each flow from its own button", () => {
  const source = readFileSync(routeFile("/(tabs)/bookings/[id]"), "utf8");
  const opened = [...source.matchAll(/bookingScanHref\(booking, "(\w+)"\)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(opened, ["add", "checkin", "checkout", "fulfil"]);
});

const SCAN: StackRoute = {
  key: "scan-1",
  name: "scan",
  params: { bookingId: "bk_1" },
};

test("the booking scanner runs on top of its own booking", () => {
  const routes: StackRoute[] = [
    { key: "list", name: "index" },
    { key: "a", name: BOOKING_DETAIL_ROUTE_NAME, params: { id: "bk_1" } },
    SCAN,
  ];
  assert.equal(sitsOnItsBooking(routes, "scan-1", "bk_1"), true);
});

test("a scanner still being pushed sits on the stack's current top", () => {
  const beforePush: StackRoute[] = [
    { key: "list", name: "index" },
    { key: "a", name: BOOKING_DETAIL_ROUTE_NAME, params: { id: "bk_1" } },
  ];
  assert.equal(sitsOnItsBooking(beforePush, "scan-1", "bk_1"), true);
  assert.equal(sitsOnItsBooking(beforePush, "scan-1", "bk_2"), false);
  assert.equal(
    sitsOnItsBooking([{ key: "list", name: "index" }], "scan-1", "bk_1"),
    false
  );
});

test("the booking scanner does not run over another booking, a list or nothing", () => {
  const other: StackRoute[] = [
    { key: "a", name: BOOKING_DETAIL_ROUTE_NAME, params: { id: "bk_2" } },
    SCAN,
  ];
  assert.equal(sitsOnItsBooking(other, "scan-1", "bk_1"), false);
  assert.equal(
    sitsOnItsBooking([{ key: "list", name: "index" }, SCAN], "scan-1", "bk_1"),
    false
  );
  assert.equal(sitsOnItsBooking([SCAN], "scan-1", "bk_1"), false);
  assert.equal(sitsOnItsBooking([], "scan-1", "bk_1"), false);
});

test("the booking detail route name matches the Bookings stack's route file", () => {
  assert.ok(
    existsSync(routeFile(`/(tabs)/bookings/${BOOKING_DETAIL_ROUTE_NAME}`))
  );
});

test("leaving the booking scanner waits for a pending request, then asks before discarding", () => {
  assert.equal(
    bookingScanLeaveDecision({ submitting: true, itemCount: 3 }),
    "hold"
  );
  assert.equal(
    bookingScanLeaveDecision({ submitting: true, itemCount: 0 }),
    "hold"
  );
  assert.equal(
    bookingScanLeaveDecision({ submitting: false, itemCount: 3 }),
    "prompt"
  );
  assert.equal(
    bookingScanLeaveDecision({ submitting: false, itemCount: 0 }),
    "leave"
  );
});
