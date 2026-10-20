/**
 * Tests for the asset screen's kit-member custody block.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./kit-member-custody.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { kitMemberCustodyBlock } from "./kit-member-custody";

const CAMERA_KIT = {
  id: "kit-camera",
  name: "Camera Kit",
  status: "AVAILABLE",
};

test("an individually tracked kit member is blocked, with the kit named", () => {
  assert.deepEqual(
    kitMemberCustodyBlock({ type: "INDIVIDUAL", kit: CAMERA_KIT }),
    {
      title: "Asset is part of a kit",
      reason:
        'This asset is part of kit "Camera Kit". Assign custody to the kit, or remove the asset from the kit first.',
    }
  );
});

test("a server that sends no type still blocks a kit member", () => {
  // Older servers omit `type`; every such asset is individually tracked.
  assert.notEqual(
    kitMemberCustodyBlock({ type: undefined, kit: CAMERA_KIT }),
    null
  );
});

test("a quantity-tracked asset in a kit is not blocked", () => {
  // Its units outside every kit can still be assigned on their own.
  assert.equal(
    kitMemberCustodyBlock({ type: "QUANTITY_TRACKED", kit: CAMERA_KIT }),
    null
  );
});

test("an asset in no kit is not blocked", () => {
  assert.equal(kitMemberCustodyBlock({ type: "INDIVIDUAL", kit: null }), null);
});
