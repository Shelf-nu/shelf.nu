/**
 * Hover styling for returned bars on the availability calendar.
 *
 * A booking's hover repaints every bar that carries its `bookingId-<id>`
 * class, across all asset rows. A bar already drawn as returned (green) must
 * keep the COMPLETE hover, whichever row the pointer is on, and the hovered
 * bar's own hover follows what it is drawn as, not the booking's raw status.
 *
 * @see {@link file://./calendar.ts}
 */
// @vitest-environment happy-dom
import type { EventHoveringArg } from "@fullcalendar/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  RETURNED_EVENT_CLASS,
  availabilityEventClassNames,
  calendarDisplayStatus,
  handleEventMouseEnter,
  handleEventMouseLeave,
  statusClassesOnHover,
} from "./calendar";

const VIEW = "resourceTimelineMonth";

/** Two bars of one ONGOING booking on two asset rows: one still out, one
 * returned. Returns the elements plus a hover arg built for `hovered`. */
function twoBars(hovered: "live" | "returned") {
  const live = document.createElement("div");
  live.className = "bookingId-b1";
  const returned = document.createElement("div");
  returned.className = `bookingId-b1 ${RETURNED_EVENT_CLASS}`;
  document.body.append(live, returned);

  const el = hovered === "live" ? live : returned;
  const info = {
    el,
    view: { type: VIEW },
    event: {
      _def: {
        extendedProps: {
          id: "b1",
          status: "ONGOING",
          returned: hovered === "returned",
        },
      },
    },
  } as unknown as EventHoveringArg;

  return { live, returned, info };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("calendarDisplayStatus", () => {
  it("borrows COMPLETE for a returned bar and keeps the real status otherwise", () => {
    expect(calendarDisplayStatus({ status: "ONGOING", returned: true })).toBe(
      "COMPLETE"
    );
    expect(calendarDisplayStatus({ status: "ONGOING", returned: false })).toBe(
      "ONGOING"
    );
    expect(calendarDisplayStatus({ status: "RESERVED" })).toBe("RESERVED");
  });
});

describe("availabilityEventClassNames", () => {
  const sameDayStart = new Date("2026-07-10T09:00:00.000Z");
  const sameDayEnd = new Date("2026-07-10T15:30:00.000Z");

  it("draws a returned bar with the COMPLETE palette and keeps its fill on a same-day return", () => {
    const classes = availabilityEventClassNames(
      { status: "ONGOING", returned: true },
      sameDayStart,
      sameDayEnd,
      "resourceTimelineMonth"
    );

    expect(classes).toContain("md:bg-success-50");
    expect(classes).not.toContain("md:bg-purple-50");
    expect(classes.some((c) => c.includes("!bg-transparent"))).toBe(false);
  });

  it("leaves a live same-day bar on the one-day treatment", () => {
    const classes = availabilityEventClassNames(
      { status: "ONGOING" },
      sameDayStart,
      sameDayEnd,
      "resourceTimelineMonth"
    );

    expect(classes).toContain("md:bg-purple-50");
    expect(classes.some((c) => c.includes("!bg-transparent"))).toBe(true);
  });
});

describe("hover on a booking with a returned bar", () => {
  it("hovering the live bar does not paint the returned bar as live", () => {
    const { live, returned, info } = twoBars("live");

    handleEventMouseEnter(VIEW)(info);

    expect(live.classList.contains(statusClassesOnHover.ONGOING)).toBe(true);
    expect(returned.classList.contains(statusClassesOnHover.ONGOING)).toBe(
      false
    );
    expect(returned.classList.contains(statusClassesOnHover.COMPLETE)).toBe(
      true
    );

    handleEventMouseLeave(VIEW)(info);

    expect(live.classList.contains(statusClassesOnHover.ONGOING)).toBe(false);
    expect(returned.classList.contains(statusClassesOnHover.COMPLETE)).toBe(
      false
    );
  });

  it("hovering the returned bar keeps the live sibling in the booking's own hover colour", () => {
    const { live, returned, info } = twoBars("returned");

    handleEventMouseEnter(VIEW)(info);

    expect(returned.classList.contains(statusClassesOnHover.COMPLETE)).toBe(
      true
    );
    // Every bar of one booking highlights together, each in the colour it is
    // drawn with: the sibling is still out, so it must not turn green.
    expect(live.classList.contains(statusClassesOnHover.ONGOING)).toBe(true);
    expect(live.classList.contains(statusClassesOnHover.COMPLETE)).toBe(false);

    handleEventMouseLeave(VIEW)(info);

    expect(returned.classList.contains(statusClassesOnHover.COMPLETE)).toBe(
      false
    );
    expect(live.classList.contains(statusClassesOnHover.ONGOING)).toBe(false);
  });

  it("hovering a returned bar on an OVERDUE booking keeps the sibling red", () => {
    const { live, returned, info } = twoBars("returned");
    (
      info.event as unknown as { _def: { extendedProps: { status: string } } }
    )._def.extendedProps.status = "OVERDUE";

    handleEventMouseEnter(VIEW)(info);

    expect(returned.classList.contains(statusClassesOnHover.COMPLETE)).toBe(
      true
    );
    expect(live.classList.contains(statusClassesOnHover.OVERDUE)).toBe(true);
  });
});
