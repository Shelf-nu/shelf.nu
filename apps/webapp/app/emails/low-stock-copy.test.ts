/**
 * Behavior tests for the low-stock email copy builders.
 *
 * Every sentence the two stock emails print comes from `low-stock-copy.ts`, so
 * these tests pin the wording a reader sees: the "What happened" sentence for
 * each log category, the fallbacks when no fresh log row exists, the placement
 * summary, the subjects and the preheader. The module is pure, so nothing is
 * mocked.
 *
 * @see {@link file://./low-stock-copy.ts}
 */
import { afterAll, describe, expect, it } from "vitest";
import { ASSET_EDIT_ADJUSTMENT_NOTE } from "~/modules/consumption-log/constants";
import { resolveFormatPrefs } from "~/utils/date-format";
import {
  buildFactRows,
  describePlacements,
  describeStockMovement,
  displayAvailable,
  formatQuantity,
  greeting,
  lowStockHeading,
  lowStockLead,
  lowStockSubject,
  MOVEMENT_FRESHNESS_MS,
  NOT_PLACED,
  otherLowSentence,
  preheader,
  recipientFooter,
  recoveredLead,
  recoveredSubject,
  restockNotice,
  segmentsToText,
  type StockMovementLog,
} from "./low-stock-copy";

/** 24 Sep 2026, 20:53 UTC: the moment every fixture row was written. */
const CREATED_AT = new Date("2026-09-24T20:53:00.000Z");
/** One minute later: every fixture row is fresh unless a test says otherwise. */
const NOW = new Date(CREATED_AT.getTime() + 60_000);
const WHEN = "on 24 Sep 2026 at 20:53";

const PREFS = resolveFormatPrefs(
  {
    dateFormat: "DD_MMM_YYYY",
    timeFormat: "H24",
    weekStart: "MONDAY",
    timeZone: "UTC",
  },
  null
);

const DANA = { firstName: "Dana", lastName: "Reyes", displayName: null };
const SAM = { firstName: "Sam", lastName: "Ortiz", displayName: null };

/** Every string a builder returns, checked for dashes once the suite is done. */
const outputs: string[] = [];
function record<T>(value: T): T {
  if (typeof value === "string") {
    outputs.push(value);
  } else if (value && typeof value === "object") {
    outputs.push(JSON.stringify(value));
  }
  return value;
}

/** A fresh log row; tests override the fields that matter. */
function logRow(overrides: Partial<StockMovementLog> = {}): StockMovementLog {
  return {
    category: "CONSUME",
    quantity: 2,
    note: null,
    createdAt: CREATED_AT,
    performedBy: DANA,
    custodian: null,
    booking: null,
    ...overrides,
  };
}

/** Runs `describeStockMovement` with the suite's prefs, unit and clock. */
function movement(
  log: StockMovementLog | null,
  options: {
    actingUser?: typeof SAM | null;
    unit?: string | null;
    now?: Date;
  } = {}
) {
  return record(
    describeStockMovement({
      log,
      actingUser: options.actingUser ?? null,
      prefs: PREFS,
      unitOfMeasure: options.unit === undefined ? "Units" : options.unit,
      now: options.now ?? NOW,
    })
  );
}

afterAll(() => {
  // Repo rule: no em or en dashes in anything a user reads.
  expect(outputs.length).toBeGreaterThan(0);
  for (const out of outputs) {
    expect(out).not.toMatch(/[\u2013\u2014]/);
  }
});

describe("formatQuantity", () => {
  it("prints the unit after the number", () => {
    expect(record(formatQuantity(2, "Units"))).toBe("2 Units");
  });

  it("prints the bare number for an empty or missing unit, never a default word", () => {
    expect(record(formatQuantity(2, ""))).toBe("2");
    expect(record(formatQuantity(2, "   "))).toBe("2");
    expect(record(formatQuantity(2, null))).toBe("2");
  });
});

describe("displayAvailable", () => {
  it("shows 0 when custody exceeds stock", () => {
    expect(displayAvailable(-3)).toBe(0);
  });

  it("leaves a positive count alone", () => {
    expect(displayAvailable(4)).toBe(4);
  });
});

describe("describeStockMovement: one sentence per log category", () => {
  it("CHECKOUT names the custodian and who checked out", () => {
    const out = movement(
      logRow({ category: "CHECKOUT", custodian: { name: "Van crew" } })
    );
    expect(out).toEqual({
      text: `2 Units checked out to Van crew by Dana Reyes ${WHEN}`,
    });
  });

  it("CHECKOUT prefers a registered custodian's display name", () => {
    const out = movement(
      logRow({
        category: "CHECKOUT",
        custodian: {
          name: "Jordan Lee",
          user: { firstName: "Jordan", lastName: "Lee", displayName: "Jo" },
        },
      })
    );
    expect(out?.text).toBe(`2 Units checked out to Jo by Dana Reyes ${WHEN}`);
  });

  it("CHECKOUT without a custodian drops the 'to' part", () => {
    const out = movement(logRow({ category: "CHECKOUT", custodian: null }));
    expect(out?.text).toBe(`2 Units checked out by Dana Reyes ${WHEN}`);
  });

  it("CONSUME without a booking", () => {
    expect(movement(logRow({ category: "CONSUME" }))).toEqual({
      text: `2 Units used up by Dana Reyes ${WHEN}`,
    });
  });

  it("CONSUME during a booking names it and links it", () => {
    const out = movement(
      logRow({
        category: "CONSUME",
        booking: { id: "bk-1", name: "Spring Fair" },
      })
    );
    expect(out).toEqual({
      text: `2 Units used up by Dana Reyes during booking Spring Fair ${WHEN}`,
      href: "/bookings/bk-1",
    });
  });

  it("LOSS", () => {
    expect(movement(logRow({ category: "LOSS" }))?.text).toBe(
      `2 Units reported lost by Dana Reyes ${WHEN}`
    );
  });

  it("DAMAGE", () => {
    expect(movement(logRow({ category: "DAMAGE" }))?.text).toBe(
      `2 Units reported damaged by Dana Reyes ${WHEN}`
    );
  });

  it("ADJUSTMENT quotes the note", () => {
    const out = movement(
      logRow({ category: "ADJUSTMENT", note: "Recount after audit" })
    );
    expect(out?.text).toBe(
      `Quantity adjusted by Dana Reyes "Recount after audit" ${WHEN}`
    );
  });

  it("ADJUSTMENT folds a multi-line note onto one line", () => {
    const out = movement(
      logRow({ category: "ADJUSTMENT", note: "  Shelf B\n  recount " })
    );
    expect(out?.text).toBe(
      `Quantity adjusted by Dana Reyes "Shelf B recount" ${WHEN}`
    );
  });

  it("ADJUSTMENT from the asset edit form says so instead of quoting its note", () => {
    const out = movement(
      logRow({ category: "ADJUSTMENT", note: ASSET_EDIT_ADJUSTMENT_NOTE })
    );
    expect(out?.text).toBe(
      `Quantity adjusted by Dana Reyes on the asset edit page ${WHEN}`
    );
  });

  it("ADJUSTMENT without a note", () => {
    expect(movement(logRow({ category: "ADJUSTMENT" }))?.text).toBe(
      `Quantity adjusted by Dana Reyes ${WHEN}`
    );
  });

  it("RESTOCK", () => {
    expect(movement(logRow({ category: "RESTOCK", quantity: 12 }))?.text).toBe(
      `12 Units restocked by Dana Reyes ${WHEN}`
    );
  });

  it("RETURN names who returned the units", () => {
    const out = movement(
      logRow({ category: "RETURN", custodian: { name: "Van crew" } })
    );
    expect(out?.text).toBe(`2 Units returned by Van crew ${WHEN}`);
  });

  it("RETURN without a custodian drops the 'by' part", () => {
    expect(movement(logRow({ category: "RETURN" }))?.text).toBe(
      `2 Units returned ${WHEN}`
    );
  });

  it("an empty unit label prints the bare number", () => {
    expect(movement(logRow(), { unit: "" })?.text).toBe(
      `2 used up by Dana Reyes ${WHEN}`
    );
  });

  it("formats the date and time in the recipient's preferences", () => {
    const us = resolveFormatPrefs(
      {
        dateFormat: "MM_DD_YYYY",
        timeFormat: "H12",
        weekStart: "SUNDAY",
        timeZone: "America/New_York",
      },
      null
    );
    const out = describeStockMovement({
      log: logRow(),
      actingUser: null,
      prefs: us,
      unitOfMeasure: "Units",
      now: NOW,
    });
    expect(record(out)?.text).toBe(
      "2 Units used up by Dana Reyes on 09/24/2026 at 4:53 PM"
    );
  });
});

describe("describeStockMovement: stale or missing log row", () => {
  const stale = new Date(CREATED_AT.getTime() + MOVEMENT_FRESHNESS_MS + 1);

  it("a row exactly at the freshness limit still explains the change", () => {
    const edge = new Date(CREATED_AT.getTime() + MOVEMENT_FRESHNESS_MS);
    expect(movement(logRow(), { now: edge })?.text).toBe(
      `2 Units used up by Dana Reyes ${WHEN}`
    );
  });

  it("a stale row with an acting user names the acting user", () => {
    expect(movement(logRow(), { now: stale, actingUser: SAM })).toEqual({
      text: "Quantity was edited by Sam Ortiz",
    });
  });

  it("a stale row without an acting user says the quantity was edited", () => {
    expect(movement(logRow(), { now: stale })).toEqual({
      text: "Quantity was edited",
    });
  });

  it("no row with an acting user names the acting user", () => {
    expect(movement(null, { actingUser: SAM })).toEqual({
      text: "Quantity was edited by Sam Ortiz",
    });
  });

  it("no row and no acting user leaves the row out", () => {
    expect(movement(null)).toBeNull();
  });
});

describe("describePlacements", () => {
  it("sums manual and kit-driven rows per location, largest first", () => {
    const out = describePlacements([
      { quantity: 1, location: { name: "Van 3" } },
      { quantity: 1, location: { name: "Ogden warehouse" } },
      { quantity: 1, location: { name: "Ogden warehouse" } },
    ]);
    expect(record(out)).toBe("Ogden warehouse: 2, Van 3: 1");
  });

  it("says the asset is not placed when there are no rows", () => {
    expect(record(describePlacements([]))).toBe(NOT_PLACED);
  });
});

describe("subjects", () => {
  const numbers = {
    assetTitle: "Blue Pens",
    available: 2,
    minQuantity: 5,
    unitOfMeasure: "Units",
  };

  it("alert subject carries the numbers", () => {
    expect(record(lowStockSubject(numbers))).toBe(
      "Low stock: Blue Pens (2 Units left, minimum 5)"
    );
  });

  it("alert subject with an empty unit has no double space", () => {
    const out = record(lowStockSubject({ ...numbers, unitOfMeasure: "" }));
    expect(out).toBe("Low stock: Blue Pens (2 left, minimum 5)");
    expect(out).not.toMatch(/ {2}/);
  });

  it("alert subject reads out of stock at zero and below", () => {
    expect(record(lowStockSubject({ ...numbers, available: 0 }))).toBe(
      "Out of stock: Blue Pens"
    );
    expect(record(lowStockSubject({ ...numbers, available: -3 }))).toBe(
      "Out of stock: Blue Pens"
    );
  });

  it("back-in-stock subject carries the numbers", () => {
    expect(record(recoveredSubject({ ...numbers, available: 14 }))).toBe(
      "Back in stock: Blue Pens (14 Units, minimum 5)"
    );
  });
});

describe("preheader", () => {
  const used = { text: `2 Units used up by Dana Reyes ${WHEN}` };

  it("joins the movement and where the stock is", () => {
    expect(
      record(preheader({ movement: used, placements: "Ogden warehouse: 2" }))
    ).toBe(
      `2 Units used up by Dana Reyes ${WHEN}. Stock is at Ogden warehouse: 2.`
    );
  });

  it("says the stock is not placed when it is not", () => {
    expect(record(preheader({ movement: used, placements: NOT_PLACED }))).toBe(
      `2 Units used up by Dana Reyes ${WHEN}. Not placed at a location.`
    );
  });

  it("starts at the placement when there is no movement", () => {
    expect(
      record(preheader({ movement: null, placements: "Ogden warehouse: 2" }))
    ).toBe("Stock is at Ogden warehouse: 2.");
  });
});

describe("otherLowSentence", () => {
  it("is singular for one item", () => {
    expect(record(otherLowSentence(1))).toBe(
      "1 other item is below its minimum"
    );
  });

  it("is plural for several", () => {
    expect(record(otherLowSentence(3))).toBe(
      "3 other items are below their minimum"
    );
  });
});

describe("buildFactRows", () => {
  const base = {
    movement: null,
    placements: NOT_PLACED,
    inCustody: 0,
    otherLowCount: 0,
    unitOfMeasure: "Units",
  };

  it("always shows where the stock is, and nothing it has no fact for", () => {
    expect(record(buildFactRows(base))).toEqual([
      { label: "Where it is", value: NOT_PLACED },
    ]);
  });

  it("lists every fact in order, with the booking and list links", () => {
    const rows = record(
      buildFactRows({
        ...base,
        movement: { text: "2 Units used up", href: "/bookings/bk-1" },
        placements: "Ogden warehouse: 2",
        inCustody: 3,
        otherLowCount: 1,
      })
    );
    expect(rows).toEqual([
      {
        label: "What happened",
        value: "2 Units used up",
        link: { text: "Open booking", href: "/bookings/bk-1" },
      },
      { label: "Where it is", value: "Ogden warehouse: 2" },
      { label: "Out with people", value: "3 Units" },
      {
        label: "Also low",
        value: "1 other item is below its minimum",
        link: {
          text: "See all low-stock items",
          href: "/assets?lowStockOnly=true",
        },
      },
    ]);
  });
});

describe("headings, leads and notices", () => {
  const numbers = {
    assetTitle: "Blue Pens",
    organizationName: "Clearwater Supply",
    available: 2,
    minQuantity: 5,
    unitOfMeasure: "Units",
  };

  it("alert lead bolds the title and both quantities", () => {
    const lead = record(lowStockLead(numbers));
    expect(segmentsToText(lead)).toBe(
      "Blue Pens in Clearwater Supply is down to 2 Units. Your minimum is 5 Units."
    );
    expect(lead.filter((s) => s.bold).map((s) => s.text)).toEqual([
      "Blue Pens",
      "2 Units",
      "5 Units",
    ]);
    expect(record(lowStockHeading(2))).toBe("Low stock");
  });

  it("out-of-stock lead and heading, also when custody exceeds stock", () => {
    const lead = record(lowStockLead({ ...numbers, available: -3 }));
    expect(segmentsToText(lead)).toBe(
      "Blue Pens in Clearwater Supply is out of stock. Your minimum is 5 Units."
    );
    expect(record(lowStockHeading(-3))).toBe("Out of stock");
  });

  it("back-in-stock lead", () => {
    const lead = record(recoveredLead({ ...numbers, available: 14 }));
    expect(segmentsToText(lead)).toBe(
      "Blue Pens in Clearwater Supply is back to 14 Units, above your minimum of 5 Units."
    );
  });

  it("restock notice names the minimum", () => {
    expect(record(restockNotice(5, "Units"))).toBe(
      'Restock and adjust the quantity on the asset, and this alert clears. You get a "back in stock" email once it is above 5 Units again.'
    );
  });

  it("greeting falls back to a bare salutation", () => {
    expect(record(greeting("Sam"))).toBe("Hey Sam,");
    expect(record(greeting(""))).toBe("Hey,");
  });

  it("footer names the address, the workspace and why", () => {
    const footer = record(
      recipientFooter({
        email: "sam@clearwater.test",
        organizationName: "Clearwater Supply",
      })
    );
    expect(segmentsToText(footer)).toBe(
      'This email was sent to sam@clearwater.test because you are an owner or admin of "Clearwater Supply". Every owner and admin of the workspace received it. To change when it fires, edit the minimum quantity on the asset.'
    );
  });
});
