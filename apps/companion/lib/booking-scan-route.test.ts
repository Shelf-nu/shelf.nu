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
import ts from "typescript";

import {
  BOOKING_DETAIL_ROUTE_NAME,
  BOOKING_SCAN_BACK_ACTIONS,
  BOOKING_SCAN_PATHNAME,
  BOOKING_SCAN_SENT,
  bookingScanGuard,
  bookingScanScreenDecision,
  takeScannerOpening,
  bookingScanHref,
  bookingScanLeaveDecision,
  parseBookingScanParams,
  sitsOnItsBooking,
  type BookingScanAction,
  type StackRoute,
} from "./booking-scan-route";

const APP_DIR = join(__dirname, "..", "app");
/** The scanner screen both scanner routes render. */
const SCANNER_SCREEN = join(
  __dirname,
  "..",
  "components",
  "scanner",
  "scanner-screen.tsx"
);

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
  for (const file of [routeFile("/(tabs)/scanner"), SCANNER_SCREEN]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /useLocalSearchParams|useGlobalSearchParams/);
  }
});

test("no screen opens the Scan tab with a booking", () => {
  const offenders = sourceFiles(APP_DIR)
    .concat(sourceFiles(join(APP_DIR, "..", "lib")))
    .concat(sourceFiles(join(APP_DIR, "..", "components")))
    .filter((file) => /\/\(tabs\)\/scanner\?/.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});

/** Parses a TSX source file into a TypeScript syntax tree. */
function parseTsx(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
}

/** Every call in a file to a function with this name. */
function callsTo(source: ts.SourceFile, name: string): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      found.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The name of the `const` a node is declared in, if any. */
function enclosingConst(node: ts.Node): string | undefined {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (ts.isVariableDeclaration(at) && ts.isIdentifier(at.name)) {
      return at.name.text;
    }
  }
  return undefined;
}

/** The JSX element whose attribute holds a node, with that attribute's name. */
function enclosingJsxAttribute(
  node: ts.Node
): { attribute: string; element: ts.JsxAttributes } | undefined {
  for (let at: ts.Node | undefined = node; at; at = at.parent) {
    if (ts.isJsxAttribute(at) && ts.isJsxAttributes(at.parent)) {
      return { attribute: at.name.getText(), element: at.parent };
    }
  }
  return undefined;
}

test("the booking screen opens the scanner only through its one-push gate", () => {
  const source = parseTsx(routeFile("/(tabs)/bookings/[id]"));
  // Every push to the booking scanner goes through openBookingScanner, which
  // ignores a second tap while the first push is in flight.
  for (const call of callsTo(source, "bookingScanHref")) {
    assert.equal(enclosingConst(call), "openBookingScanner");
  }
  const flows = callsTo(source, "openBookingScanner")
    .map((call) => (call.arguments[0] as ts.StringLiteral).text)
    .sort();
  assert.deepEqual(flows, ["add", "checkin", "checkout", "fulfil"]);
});

test("the booking screen clears the Scan gate whenever it gains focus", () => {
  const source = parseTsx(routeFile("/(tabs)/bookings/[id]"));
  const clears = callsTo(source, "useFocusEffect").some((call) =>
    /scannerOpening\.current = false/.test(call.getText())
  );
  assert.ok(clears, "a useFocusEffect must reset scannerOpening");
});

test("a second tap on a Scan button is ignored until the booking regains focus", () => {
  const gate = { current: false };
  assert.equal(takeScannerOpening(gate), true);
  assert.equal(takeScannerOpening(gate), false);
  gate.current = false; // the booking screen gained focus again
  assert.equal(takeScannerOpening(gate), true);
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

test("a finished flow leaves without asking to discard what it sent", () => {
  assert.equal(bookingScanLeaveDecision(BOOKING_SCAN_SENT), "leave");
});

test("finished flows go back only through leaveAfterSubmit", () => {
  const source = parseTsx(SCANNER_SCREEN);
  // Going back to the booking is returnToBooking. Outside the back arrow, it
  // runs only inside leaveAfterSubmit, which marks the scans sent first; so
  // no finished flow can go back and be asked to discard what it sent.
  const calls = callsTo(source, "returnToBooking");
  assert.ok(calls.length > 0, "the scanner must go back somewhere");
  for (const call of calls) {
    if (enclosingConst(call) === "leaveAfterSubmit") continue;
    const jsx = enclosingJsxAttribute(call);
    assert.equal(jsx?.attribute, "onPress", "returnToBooking outside onPress");
    assert.match(
      jsx?.element.getText() ?? "",
      /accessibilityLabel="Go back"/,
      "only the back arrow may call returnToBooking directly"
    );
  }

  // Every handler that records a finished flow (it marks the booking for a
  // refetch) goes back, when it does, through leaveAfterSubmit.
  const finished = callsTo(source, "markBookingDirty");
  assert.ok(finished.length > 0, "the finished flows must be found");
  for (const call of finished) {
    let handler: ts.Node | undefined = call.parent;
    while (handler && !ts.isArrowFunction(handler)) handler = handler.parent;
    assert.ok(handler, "markBookingDirty outside a handler");
    assert.match(
      handler.getText(),
      /leaveAfterSubmit\(\)/,
      `a finished flow at line ${
        source.getLineAndCharacterOfPosition(call.getStart()).line + 1
      } must leave through leaveAfterSubmit`
    );
  }

  // leaveAfterSubmit marks the scans sent before it goes back.
  const helper = callsTo(source, "returnToBooking").find(
    (call) => enclosingConst(call) === "leaveAfterSubmit"
  );
  assert.ok(helper, "leaveAfterSubmit must go back through returnToBooking");
  const body = helper.parent.parent as ts.Block;
  const statements = body.statements.map((st) => st.getText());
  const marks = statements.findIndex((text) =>
    /bookingLeaveRef\.current = BOOKING_SCAN_SENT/.test(text)
  );
  const leaves = statements.findIndex((text) =>
    text.startsWith("returnToBooking(")
  );
  assert.ok(marks !== -1 && marks < leaves, "mark the scans sent first");
});

test("the booking scanner route opens the list, the booking or the scanner", () => {
  const onBooking: StackRoute[] = [
    { key: "list", name: "index" },
    { key: "a", name: BOOKING_DETAIL_ROUTE_NAME, params: { id: "bk_1" } },
    SCAN,
  ];
  assert.deepEqual(
    bookingScanScreenDecision({
      params: {},
      routes: onBooking,
      ownKey: "scan-1",
    }),
    { kind: "list" }
  );
  assert.deepEqual(
    bookingScanScreenDecision({
      params: { bookingId: "bk_2", bookingAction: "checkout" },
      routes: onBooking,
      ownKey: "scan-1",
    }),
    { kind: "booking", bookingId: "bk_2" }
  );
  assert.deepEqual(
    bookingScanScreenDecision({
      params: { bookingId: "bk_1", bookingAction: "checkout" },
      routes: onBooking,
      ownKey: "scan-1",
    }),
    { kind: "scan", booking: { bookingId: "bk_1", action: "checkout" } }
  );
  // A double tap: the second scanner sits on the first, not on the booking.
  const doubled: StackRoute[] = [...onBooking, { ...SCAN, key: "scan-2" }];
  assert.deepEqual(
    bookingScanScreenDecision({
      params: { bookingId: "bk_1", bookingAction: "add" },
      routes: doubled,
      ownKey: "scan-2",
    }),
    { kind: "booking", bookingId: "bk_1" }
  );
});

test("the booking scanner guard stops only a person's own back", () => {
  for (const type of ["GO_BACK", "POP", "POP_TO_TOP"]) {
    assert.ok(BOOKING_SCAN_BACK_ACTIONS.includes(type), type);
  }
  for (const type of ["RESET", "NAVIGATE", "REPLACE", "POP_TO"]) {
    assert.ok(!BOOKING_SCAN_BACK_ACTIONS.includes(type), type);
  }
  const guard = bookingScanGuard(() => ({ submitting: true, itemCount: 2 }));
  assert.equal(guard.decide(), "hold");
  assert.ok(guard.holdNotice.message.length > 0);
});
