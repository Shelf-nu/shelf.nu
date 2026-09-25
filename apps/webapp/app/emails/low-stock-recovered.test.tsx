/**
 * Rendering tests for the back-in-stock email.
 *
 * The notice shares its layout with the low-stock alert, so these tests focus
 * on what differs (heading, lead, yellow box) and re-check the facts, footer
 * and custom footer that every copy must carry. Fact strings are built once
 * and looked for in both the HTML and the plain text.
 *
 * @see {@link file://./low-stock-recovered.tsx}
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

import {
  lowStockRecoveredHtml,
  lowStockRecoveredText,
} from "./low-stock-recovered";
import type { LowStockRecoveredProps } from "./low-stock-recovered";

const SERVER_URL = "https://app.shelf.nu";

/** One recipient's facts: Blue Pens restocked to 14 above a minimum of 5. */
function recoveredProps(
  overrides: Partial<LowStockRecoveredProps> = {}
): LowStockRecoveredProps {
  return {
    recipient: { greetingName: "Sam", email: "sam@clearwater.test" },
    assetTitle: "Blue Pens",
    assetId: "asset-1",
    available: 14,
    minQuantity: 5,
    unitOfMeasure: "Units",
    organizationName: "Clearwater Supply",
    customEmailFooter: null,
    movement: {
      text: "12 Units restocked by Dana Reyes on 24 Sep 2026 at 21:10",
    },
    placements: "Ogden warehouse: 14",
    inCustody: 0,
    otherLowCount: 2,
    serverUrl: SERVER_URL,
    ...overrides,
  };
}

/** The HTML and text body of one render, with the HTML's visible text. */
async function renderRecovered(props: LowStockRecoveredProps) {
  const html = await lowStockRecoveredHtml(props);
  const text = lowStockRecoveredText(props);
  const visible =
    new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
  return { html, text, visible };
}

describe("back-in-stock email", () => {
  it("carries every fact in both the HTML and the plain text", async () => {
    const { html, text, visible } = await renderRecovered(recoveredProps());

    const facts = [
      "Hey Sam,",
      "Back in stock",
      "Blue Pens in Clearwater Supply is back to 14 Units, above your minimum of 5 Units.",
      "What happened",
      "12 Units restocked by Dana Reyes on 24 Sep 2026 at 21:10",
      "Where it is",
      "Ogden warehouse: 14",
      "Also low",
      "2 other items are below their minimum",
      "See all low-stock items",
      "Open asset",
      "No action needed.",
      "The Shelf Team",
    ];
    for (const fact of facts) {
      expect(visible).toContain(fact);
      expect(text).toContain(fact);
    }

    for (const link of [
      `${SERVER_URL}/assets/asset-1/overview`,
      `${SERVER_URL}/assets?lowStockOnly=true`,
    ]) {
      expect(html).toContain(`href="${link}"`);
      expect(text).toContain(link);
    }

    // No units are out, and no booking is named, so neither row nor link shows.
    for (const body of [visible, text]) {
      expect(body).not.toContain("Out with people");
      expect(body).not.toContain("Open booking");
      expect(body).not.toContain("Restock and adjust");
    }
  });

  it("footer names the recipient's address and the workspace", async () => {
    const { text, visible } = await renderRecovered(recoveredProps());
    const footer =
      'This email was sent to sam@clearwater.test because you are an owner or admin of "Clearwater Supply". Every owner and admin of the workspace received it. To change when it fires, edit the minimum quantity on the asset.';
    expect(visible).toContain(footer);
    expect(text).toContain(footer);
  });

  it("shows the workspace's custom footer only when one is set", async () => {
    const custom = "Clearwater Supply, 12 Harbor Road";
    const withFooter = await renderRecovered(
      recoveredProps({ customEmailFooter: custom })
    );
    expect(withFooter.visible).toContain(custom);
    expect(withFooter.text).toContain(`---\n${custom}`);

    const without = await renderRecovered(recoveredProps());
    expect(without.visible).not.toContain(custom);
    expect(without.text).not.toContain("\n---\n");
  });

  it("leaves out Also low when nothing else is low, but always says where the stock is", async () => {
    const { text, visible } = await renderRecovered(
      recoveredProps({
        otherLowCount: 0,
        placements: "Not placed at a location",
      })
    );
    for (const body of [visible, text]) {
      expect(body).not.toContain("Also low");
      expect(body).toContain("Where it is");
      expect(body).toContain("Not placed at a location");
    }
  });

  it("contains no em or en dash", async () => {
    const { html, text } = await renderRecovered(recoveredProps());
    expect(html).not.toMatch(/[\u2013\u2014]|&mdash;|&ndash;/);
    expect(text).not.toMatch(/[\u2013\u2014]/);
  });
});
