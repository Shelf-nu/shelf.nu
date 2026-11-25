/**
 * Tests for the capability header the app sends with every API request.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./client-capabilities.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPABILITIES_HEADER,
  clientCapabilityHeaders,
} from "./client-capabilities";

test("announces booking sources in the header the server reads", () => {
  assert.equal(CAPABILITIES_HEADER, "X-Shelf-Capabilities");
  assert.deepEqual(clientCapabilityHeaders(), {
    "X-Shelf-Capabilities": "booking-sources",
  });
});
