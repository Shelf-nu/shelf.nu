/**
 * Unit tests for the pure distribution helpers.
 *
 * These helpers have no I/O, so they can be tested with a deterministic RNG
 * (a `mulberry32`-style stepper) and asserted directly.
 */

import { describe, expect, test } from "vitest";

import {
  paretoIndex,
  randomDateBetween,
  randomIntInRange,
  seasonalMultiplier,
  weightedPick,
  zipfWeights,
} from "./distributions";

/** Simple, deterministic PRNG — not cryptographic, perfect for tests. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("paretoIndex", () => {
  test("returns values within [0, size)", () => {
    const rng = makeRng(1);
    for (let i = 0; i < 1000; i++) {
      const idx = paretoIndex(100, rng);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(100);
    }
  });

  test("top 20% of indices take >= 50% of draws", () => {
    const rng = makeRng(42);
    const size = 100;
    const draws = 10_000;
    const threshold = Math.floor(size * 0.2); // top 20% = indices < 20
    let headCount = 0;
    for (let i = 0; i < draws; i++) {
      if (paretoIndex(size, rng) < threshold) headCount++;
    }
    expect(headCount / draws).toBeGreaterThanOrEqual(0.5);
  });

  test("throws on non-positive size", () => {
    expect(() => paretoIndex(0, Math.random)).toThrow();
    expect(() => paretoIndex(-1, Math.random)).toThrow();
  });
});

describe("seasonalMultiplier", () => {
  test("peak months are higher than trough months", () => {
    expect(seasonalMultiplier(5)).toBeGreaterThan(seasonalMultiplier(0)); // Jun > Jan
    expect(seasonalMultiplier(6)).toBeGreaterThan(seasonalMultiplier(1)); // Jul > Feb
  });

  test("average across 12 months is close to 1.0", () => {
    const total = Array.from({ length: 12 }, (_, m) =>
      seasonalMultiplier(m)
    ).reduce((a, b) => a + b, 0);
    const avg = total / 12;
    expect(avg).toBeGreaterThan(0.9);
    expect(avg).toBeLessThan(1.1);
  });
});

describe("zipfWeights", () => {
  test("returns empty array for count = 0", () => {
    expect(zipfWeights(0)).toEqual([]);
  });

  test("weights sum to ~1.0", () => {
    const w = zipfWeights(18);
    const sum = w.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 6);
  });

  test("first weight is strictly greater than last", () => {
    const w = zipfWeights(18);
    expect(w[0]).toBeGreaterThan(w[17]);
  });
});

describe("weightedPick", () => {
  test("always returns a valid index for normalised weights", () => {
    const rng = makeRng(7);
    const w = zipfWeights(5);
    for (let i = 0; i < 500; i++) {
      const idx = weightedPick(w, rng);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(5);
    }
  });

  test("picks index 0 when weights concentrate there", () => {
    const rng = makeRng(3);
    expect(weightedPick([1, 0, 0, 0], rng)).toBe(0);
  });
});

describe("randomIntInRange", () => {
  test("respects inclusive bounds", () => {
    const rng = makeRng(5);
    for (let i = 0; i < 500; i++) {
      const n = randomIntInRange(3, 7, rng);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
    }
  });

  test("throws when max < min", () => {
    expect(() => randomIntInRange(10, 5, Math.random)).toThrow();
  });
});

describe("randomDateBetween", () => {
  test("returns a date within the half-open window", () => {
    const rng = makeRng(9);
    const start = new Date("2025-01-01T00:00:00Z");
    const end = new Date("2025-02-01T00:00:00Z");
    for (let i = 0; i < 200; i++) {
      const d = randomDateBetween(start, end, rng);
      expect(d.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(d.getTime()).toBeLessThan(end.getTime());
    }
  });

  test("throws when end <= start", () => {
    const d = new Date();
    expect(() => randomDateBetween(d, d, Math.random)).toThrow();
  });
});
