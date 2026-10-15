/**
 * Tests for the model reservation shortfall wording.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./model-reservation-shortfall.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MODEL_SHORTFALL_NOTICE,
  modelShortfallLabel,
  shortfallsByModelId,
} from "./model-reservation-shortfall";

test("a short row says how many it lacks and how many are still free", () => {
  assert.equal(
    modelShortfallLabel({ short: 2, available: 1 }),
    "2 short: only 1 free"
  );
  assert.equal(
    modelShortfallLabel({ short: 3, available: 0 }),
    "3 short: none free"
  );
});

test("the section notice reads as the web's", () => {
  assert.equal(
    MODEL_SHORTFALL_NOTICE,
    "Not enough units are free for this booking's dates. Reduce the reservation to what can be assigned."
  );
});

test("each reservation row finds its own shortfall by model", () => {
  const camera = {
    assetModelId: "model-camera",
    modelName: "Camera",
    outstanding: 3,
    available: 1,
    short: 2,
  };
  const byModel = shortfallsByModelId([camera]);
  assert.equal(byModel.get("model-camera"), camera);
  assert.equal(byModel.get("model-lens"), undefined);
});

test("a server that sends no shortfalls marks no row", () => {
  assert.equal(shortfallsByModelId(undefined).size, 0);
});
