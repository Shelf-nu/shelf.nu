/**
 * Reading a stored template config: a row saved before a key existed, or one
 * with a value it cannot read, still prints, filling the gap from the
 * Checklist template.
 *
 * @see {@link file://./config.ts}
 */
import { describe, expect, it } from "vitest";
import {
  BOOKING_CHECKLIST_CONFIG,
  CHECKOUT_RECEIPT_CONFIG,
  parseBookingTemplateConfig,
} from "./config";

describe("parseBookingTemplateConfig", () => {
  it("reads a complete config as stored", () => {
    expect(parseBookingTemplateConfig(CHECKOUT_RECEIPT_CONFIG)).toEqual(
      CHECKOUT_RECEIPT_CONFIG
    );
  });

  it("fills every key an older row lacks from the Checklist template", () => {
    expect(
      parseBookingTemplateConfig({
        totalValue: false,
        columns: { image: false },
      })
    ).toEqual({
      ...BOOKING_CHECKLIST_CONFIG,
      totalValue: false,
      columns: { ...BOOKING_CHECKLIST_CONFIG.columns, image: false },
    });
  });

  it("replaces only the values it cannot read", () => {
    expect(
      parseBookingTemplateConfig({
        groupBy: "location",
        sortBy: "name",
        signatureLines: "yes",
      })
    ).toEqual({
      ...BOOKING_CHECKLIST_CONFIG,
      sortBy: "name",
    });
  });

  it("keeps at most three distinct custom fields", () => {
    expect(
      parseBookingTemplateConfig({ customFieldIds: ["a", "b", "a", "c", "d"] })
        .customFieldIds
    ).toEqual(["a", "b", "c"]);
  });

  it("prints the Checklist for an empty or unreadable config", () => {
    expect(parseBookingTemplateConfig({})).toEqual(BOOKING_CHECKLIST_CONFIG);
    expect(parseBookingTemplateConfig(null)).toEqual(BOOKING_CHECKLIST_CONFIG);
    expect(parseBookingTemplateConfig("nonsense")).toEqual(
      BOOKING_CHECKLIST_CONFIG
    );
  });
});
