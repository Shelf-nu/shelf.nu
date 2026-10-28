/**
 * Reading a stored document config: a row saved before a key existed, or one
 * with a value it cannot read, still prints, filling the gap from the
 * Checklist document.
 *
 * @see {@link file://./config.ts}
 */
import { describe, expect, it } from "vitest";
import {
  BOOKING_CHECKLIST_CONFIG,
  CHECKOUT_RECEIPT_CONFIG,
  parseBookingDocumentConfig,
} from "./config";

describe("parseBookingDocumentConfig", () => {
  it("reads a complete config as stored", () => {
    expect(parseBookingDocumentConfig(CHECKOUT_RECEIPT_CONFIG)).toEqual(
      CHECKOUT_RECEIPT_CONFIG
    );
  });

  it("fills every key an older row lacks from the Checklist document", () => {
    expect(
      parseBookingDocumentConfig({
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
      parseBookingDocumentConfig({
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
      parseBookingDocumentConfig({ customFieldIds: ["a", "b", "a", "c", "d"] })
        .customFieldIds
    ).toEqual(["a", "b", "c"]);
  });

  it("prints the Checklist for an empty or unreadable config", () => {
    expect(parseBookingDocumentConfig({})).toEqual(BOOKING_CHECKLIST_CONFIG);
    expect(parseBookingDocumentConfig(null)).toEqual(BOOKING_CHECKLIST_CONFIG);
    expect(parseBookingDocumentConfig("nonsense")).toEqual(
      BOOKING_CHECKLIST_CONFIG
    );
  });
});
