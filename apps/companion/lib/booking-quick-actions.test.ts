/**
 * Tests for reading the booking detail endpoint's `canQuickCheckout` flag.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The absent flag is the case that matters: the app ships over the air to
 * phones that may talk to a server without the explicit check-out setting.
 *
 * @see ./booking-quick-actions.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { canOfferQuickCheckout } from "./booking-quick-actions";

test("hides the one-tap check-out when the server forbids it", () => {
  assert.equal(canOfferQuickCheckout({ canQuickCheckout: false }), false);
});

test("offers the one-tap check-out when the server allows it", () => {
  assert.equal(canOfferQuickCheckout({ canQuickCheckout: true }), true);
});

test("offers the one-tap check-out when an older server omits the flag", () => {
  assert.equal(canOfferQuickCheckout({}), true);
});
