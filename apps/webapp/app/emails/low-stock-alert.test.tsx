/**
 * Rendering tests for the low-stock alert email.
 *
 * Asserts what one recipient's copy actually carries, in both the HTML and the
 * plain-text body: the greeting, the lead, every fact row, the links, the
 * yellow box and the footer naming who got the mail and why. Fact strings are
 * built once and looked for in both bodies, so the two can never drift.
 *
 * @see {@link file://./low-stock-alert.tsx}
 * @see {@link file://./components/stock-level-email.tsx}
 */
import { describe, expect, it, vi } from "vitest";

// why: env vars are read at import time; the logo and shelf.config.ts import
// from this module
vi.mock("~/utils/env", () => ({
  SERVER_URL: "https://app.shelf.nu",
  SUPPORT_EMAIL: "support@shelf.nu",
  SEND_ONBOARDING_EMAIL: false,
  ENABLE_PREMIUM_FEATURES: false,
  FREE_TRIAL_DAYS: "7",
  DISABLE_SIGNUP: false,
  DISABLE_SSO: false,
  ENABLE_SCIM: false,
  SHOW_HOW_DID_YOU_FIND_US: false,
  COLLECT_BUSINESS_INTEL: false,
  GEOCODING_USER_AGENT: "",
}));

import { lowStockAlertHtml, lowStockAlertText } from "./low-stock-alert";
import type { LowStockAlertProps } from "./low-stock-alert";

const SERVER_URL = "https://app.shelf.nu";

/** One recipient's facts: Blue Pens down to 2 of a minimum of 5. */
function alertProps(
  overrides: Partial<LowStockAlertProps> = {}
): LowStockAlertProps {
  return {
    recipient: { greetingName: "Sam", email: "sam@clearwater.test" },
    assetTitle: "Blue Pens",
    assetId: "asset-1",
    available: 2,
    minQuantity: 5,
    unitOfMeasure: "Units",
    organizationName: "Clearwater Supply",
    customEmailFooter: null,
    movement: {
      text: "2 Units used up by Dana Reyes during booking Spring Fair on 24 Sep 2026 at 20:53",
      href: "/bookings/bk-1",
    },
    placements: "Ogden warehouse: 2",
    inCustody: 3,
    otherLowCount: 1,
    serverUrl: SERVER_URL,
    ...overrides,
  };
}

/** The HTML and text body of one render, with the HTML's visible text. */
async function renderAlert(props: LowStockAlertProps) {
  const html = await lowStockAlertHtml(props);
  const text = lowStockAlertText(props);
  const visible =
    new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return { html, text, visible };
}

describe("low-stock alert email", () => {
  it("carries every fact in both the HTML and the plain text", async () => {
    const { html, text, visible } = await renderAlert(alertProps());

    const facts = [
      "Hey Sam,",
      "Low stock",
      "Blue Pens in Clearwater Supply is down to 2 Units. Your minimum is 5 Units.",
      "What happened",
      "2 Units used up by Dana Reyes during booking Spring Fair on 24 Sep 2026 at 20:53",
      "Where it is",
      "Ogden warehouse: 2",
      "Out with people",
      "3 Units",
      "Also low",
      "1 other item is below its minimum",
      "See all low-stock items",
      "Open booking",
      "Open asset",
      'Restock and adjust the quantity on the asset, and this alert clears. You get a "back in stock" email once it is above 5 Units again.',
      "The Shelf Team",
    ];
    for (const fact of facts) {
      expect(visible).toContain(fact);
      expect(text).toContain(fact);
    }

    const links = [
      `${SERVER_URL}/assets/asset-1/overview`,
      `${SERVER_URL}/bookings/bk-1`,
      `${SERVER_URL}/assets?lowStockOnly=true`,
    ];
    for (const link of links) {
      expect(html).toContain(`href="${link}"`);
      expect(text).toContain(link);
    }
  });

  it("puts the facts in the preheader", async () => {
    const { visible } = await renderAlert(alertProps());
    expect(visible).toContain(
      "2 Units used up by Dana Reyes during booking Spring Fair on 24 Sep 2026 at 20:53. Stock is at Ogden warehouse: 2."
    );
  });

  it("footer names the recipient's address and the workspace", async () => {
    const { text, visible } = await renderAlert(alertProps());
    const footer =
      'This email was sent to sam@clearwater.test because you are an owner or admin of "Clearwater Supply". Every owner and admin of the workspace received it. To change when it fires, edit the minimum quantity on the asset.';
    expect(visible).toContain(footer);
    expect(text).toContain(footer);
    expect(visible).toContain(`© ${new Date().getFullYear()} Shelf.nu`);
  });

  it("shows the workspace's custom footer when one is set", async () => {
    const custom = "Clearwater Supply, 12 Harbor Road";
    const { html, text, visible } = await renderAlert(
      alertProps({ customEmailFooter: custom })
    );
    expect(visible).toContain(custom);
    expect(text).toContain(`---\n${custom}`);
    expect(html).toContain("border-top:1px solid #EAECF0");
  });

  it("has no custom footer when none is set", async () => {
    const { html, text } = await renderAlert(
      alertProps({ customEmailFooter: null })
    );
    // The custom footer is the only block with this top border.
    expect(html).not.toContain("border-top:1px solid #EAECF0");
    expect(text).not.toContain("\n---\n");
  });

  it("leaves out the rows it has no fact for, but always says where the stock is", async () => {
    const { text, visible } = await renderAlert(
      alertProps({
        movement: null,
        placements: "Not placed at a location",
        inCustody: 0,
        otherLowCount: 0,
      })
    );
    for (const body of [visible, text]) {
      expect(body).not.toContain("What happened");
      expect(body).not.toContain("Out with people");
      expect(body).not.toContain("Also low");
      expect(body).not.toContain("See all low-stock items");
      expect(body).toContain("Where it is");
      expect(body).toContain("Not placed at a location");
    }
  });

  it("says nothing about placement when the placements could not be read", async () => {
    const { text, visible } = await renderAlert(
      alertProps({ placements: null })
    );
    for (const body of [visible, text]) {
      expect(body).not.toContain("Where it is");
      expect(body).not.toContain("Not placed");
      expect(body).not.toContain("Stock is at");
    }
  });

  it("reads out of stock when nothing is available, even below zero", async () => {
    const { text, visible } = await renderAlert(alertProps({ available: -1 }));
    const lead =
      "Blue Pens in Clearwater Supply is out of stock. Your minimum is 5 Units.";
    for (const body of [visible, text]) {
      expect(body).toContain("Out of stock");
      expect(body).toContain(lead);
      // A negative count must never reach the reader.
      expect(body).not.toMatch(/(^|\s)-1\b/);
    }
  });

  it("prints bare numbers for an asset without a unit", async () => {
    const { text, visible } = await renderAlert(
      alertProps({ unitOfMeasure: "" })
    );
    const lead =
      "Blue Pens in Clearwater Supply is down to 2. Your minimum is 5.";
    expect(visible).toContain(lead);
    expect(text).toContain(lead);
    expect(text).not.toMatch(/\d {2}/);
  });

  it("greets without a name when the recipient has none", async () => {
    const { text, visible } = await renderAlert(
      alertProps({
        recipient: { greetingName: "", email: "ops@clearwater.test" },
      })
    );
    expect(visible).toContain("Hey,");
    expect(text.startsWith("Hey,\n")).toBe(true);
  });

  it("contains no em or en dash", async () => {
    const { html, text } = await renderAlert(alertProps());
    expect(html).not.toMatch(/[\u2013\u2014]|&mdash;|&ndash;/);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
