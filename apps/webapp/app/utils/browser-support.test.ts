/**
 * Unit tests for the inline browser-support check.
 *
 * The script string is evaluated with shadowed globals so each probe can be
 * removed independently. It must stay plain ES5: it is the one piece of code
 * that has to parse in browsers the bundle itself no longer targets.
 *
 * @see {@link file://./browser-support.ts}
 */
import { describe, expect, it } from "vitest";
import {
  BROWSER_SUPPORT_CHECK_SCRIPT,
  BROWSER_SUPPORT_GATE_STYLES,
  isUnsupportedBrowser,
  UNSUPPORTED_BROWSER_ATTRIBUTE,
  UNSUPPORTED_BROWSER_SCREEN_ID,
} from "./browser-support";

type Probes = {
  hasOwn?: unknown;
  structuredClone?: unknown;
  at?: unknown;
};

const MODERN: Required<Probes> = {
  hasOwn: () => true,
  structuredClone: () => undefined,
  at: () => undefined,
};

/** Runs the inline script against a fake document and returns the html attributes it set. */
function runCheck(overrides: Probes = {}) {
  // why: the script reads `document`, `Object`, `structuredClone` and `Array`
  // as free globals. Passing fakes as function parameters shadows the real
  // ones, so each probe can be removed on its own without touching the
  // test runtime's globals.
  const probes = { ...MODERN, ...overrides };
  const attributes = new Map<string, string>();
  const fakeDocument = {
    documentElement: {
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
    },
  };

  new Function(
    "document",
    "Object",
    "structuredClone",
    "Array",
    BROWSER_SUPPORT_CHECK_SCRIPT
  )(fakeDocument, { hasOwn: probes.hasOwn }, probes.structuredClone, {
    prototype: { at: probes.at },
  });

  return attributes;
}

describe("BROWSER_SUPPORT_CHECK_SCRIPT", () => {
  it("leaves a current browser untouched", () => {
    expect(runCheck().has(UNSUPPORTED_BROWSER_ATTRIBUTE)).toBe(false);
  });

  it("flags a browser without Object.hasOwn", () => {
    expect(
      runCheck({ hasOwn: undefined }).has(UNSUPPORTED_BROWSER_ATTRIBUTE)
    ).toBe(true);
  });

  it("flags a browser without structuredClone", () => {
    expect(
      runCheck({ structuredClone: undefined }).has(
        UNSUPPORTED_BROWSER_ATTRIBUTE
      )
    ).toBe(true);
  });

  it("flags a browser without Array.prototype.at", () => {
    expect(runCheck({ at: undefined }).has(UNSUPPORTED_BROWSER_ATTRIBUTE)).toBe(
      true
    );
  });

  it("stays parseable by pre-ES2015 engines (no arrow functions, let/const, template literals)", () => {
    expect(BROWSER_SUPPORT_CHECK_SCRIPT).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });
});

describe("BROWSER_SUPPORT_GATE_STYLES", () => {
  it("hides the screen by default and reveals it for the flagged document", () => {
    expect(BROWSER_SUPPORT_GATE_STYLES).toContain(
      `#${UNSUPPORTED_BROWSER_SCREEN_ID}{display:none}`
    );
    expect(BROWSER_SUPPORT_GATE_STYLES).toContain(
      `html[${UNSUPPORTED_BROWSER_ATTRIBUTE}] #${UNSUPPORTED_BROWSER_SCREEN_ID}{display:block}`
    );
  });
});

describe("isUnsupportedBrowser", () => {
  it("mirrors the attribute on the document element", () => {
    document.documentElement.removeAttribute(UNSUPPORTED_BROWSER_ATTRIBUTE);
    expect(isUnsupportedBrowser()).toBe(false);

    document.documentElement.setAttribute(UNSUPPORTED_BROWSER_ATTRIBUTE, "");
    expect(isUnsupportedBrowser()).toBe(true);

    document.documentElement.removeAttribute(UNSUPPORTED_BROWSER_ATTRIBUTE);
  });
});
