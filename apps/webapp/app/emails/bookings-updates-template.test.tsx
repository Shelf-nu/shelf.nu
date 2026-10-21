/**
 * Booking update email template: the actor line.
 *
 * A person-triggered booking email names who acted and when, in one
 * paragraph directly under the heading. The moment follows the RECIPIENT's
 * own date, time and time zone preferences.
 *
 * @see {@link file://./bookings-updates-template.tsx}
 */
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import { bookingUpdatesTemplateString } from "./bookings-updates-template";
import type { BookingEmailActor, BookingForEmail } from "./types";

/** The fields the template and its footers read. */
const booking = {
  id: "booking-1",
  name: "Field kit",
  from: new Date("2026-10-01T08:00:00Z"),
  to: new Date("2026-10-03T17:00:00Z"),
  organizationId: "org-1",
  custodianUser: {
    id: "custodian-1",
    email: "custodian@example.com",
    firstName: "Casey",
    lastName: "Custodian",
    displayName: null,
  },
  custodianTeamMember: null,
  organization: {
    name: "Test Org",
    customEmailFooter: null,
    owner: { email: "owner@example.com" },
  },
  _count: { bookingAssets: 2 },
} as unknown as BookingForEmail;

const berlinPrefs: ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY",
  timeFormat: "H24",
  weekStartsOn: 1,
  timeZone: "Europe/Berlin",
};

const newYorkPrefs: ResolvedFormatPrefs = {
  dateFormat: "MM_DD_YYYY",
  timeFormat: "H12",
  weekStartsOn: 0,
  timeZone: "America/New_York",
};

const actor: BookingEmailActor = {
  label: "Completed by",
  name: "Jo Display",
  at: new Date("2026-09-30T14:15:00Z"),
};

/**
 * Renders the completed-booking email for the custodian with the given prefs
 * and optional actor, and parses it so tests can query the DOM.
 */
async function renderEmail(props: {
  prefs: ResolvedFormatPrefs;
  actor?: BookingEmailActor;
}) {
  const html = await bookingUpdatesTemplateString({
    booking,
    heading: 'Your booking has been completed: "Field kit"',
    assetCount: 2,
    recipientReason: "custodian",
    recipientEmail: "custodian@example.com",
    ...props,
  });
  return new DOMParser().parseFromString(html, "text/html");
}

describe("BookingUpdatesEmailTemplate actor line", () => {
  it("renders the label, name and moment directly under the heading", async () => {
    const doc = await renderEmail({ prefs: berlinPrefs, actor });

    const line = doc.querySelector("h1")?.nextElementSibling;
    expect(line?.tagName).toBe("P");
    expect(line?.textContent).toBe(
      "Completed by: Jo Display on 30/09/2026, 16:15"
    );
    // The label is bold, like the "Custodian:" label below it.
    const label = line?.querySelector("span");
    expect(label?.textContent).toBe("Completed by:");
    expect(label?.getAttribute("style")).toContain("font-weight:600");
  });

  it("formats the moment in each recipient's own date, time and time zone", async () => {
    const doc = await renderEmail({ prefs: newYorkPrefs, actor });

    expect(doc.querySelector("h1")?.nextElementSibling?.textContent).toBe(
      "Completed by: Jo Display on 09/30/2026, 10:15 AM"
    );
  });

  it("leaves the line out when no actor is given", async () => {
    const doc = await renderEmail({ prefs: berlinPrefs });

    expect(doc.querySelector("h1")?.nextElementSibling?.tagName).toBe("H2");
    expect(doc.body.textContent).not.toContain("Completed by");
    expect(doc.body.textContent).not.toContain("Jo Display");
  });
});
