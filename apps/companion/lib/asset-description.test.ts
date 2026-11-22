/**
 * Tests for the asset description length rule.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./asset-description.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  countCharacters,
  isAssetDescriptionTooLong,
} from "./asset-description";

test("a browser line break counts as one character", () => {
  assert.equal(countCharacters("a\r\nb"), 3);
});

test("a phone line break counts as one character", () => {
  assert.equal(countCharacters("a\nb"), 3);
});

test("a description of exactly 5,000 characters can be saved", () => {
  assert.equal(isAssetDescriptionTooLong("a".repeat(5000)), false);
});

test("a description of 5,001 characters cannot be saved", () => {
  assert.equal(isAssetDescriptionTooLong("a".repeat(5001)), true);
});

test("5,000 browser line breaks fit, though they are 10,000 code units", () => {
  assert.equal(isAssetDescriptionTooLong("\r\n".repeat(5000)), false);
});
