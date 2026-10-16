// @vitest-environment node
// why: detectFormatPrefsForPersistence reads the CH-time-zone cookie from the
// request header on the SERVER (document is undefined there). Under happy-dom
// `document` exists, so the helper would read the empty `document.cookie` instead
// — node env mirrors the real server path.
import { describe, expect, it, vi } from "vitest";
import type { ResolvedFormatPrefs } from "~/utils/date-format";
import {
  CLIENT_HINT_CHECK_SCRIPT,
  detectFormatPrefsForPersistence,
  formatDateBasedOnLocaleOnly,
} from "./client-hints";

/**
 * Regression guard: the custom-field date spine must render date-only values
 * using the caller's resolved prefs (absolute, no timezone conversion), NOT
 * the browser default locale it used before the configurable-format work.
 */
describe("formatDateBasedOnLocaleOnly", () => {
  const ddmmyyyy: ResolvedFormatPrefs = {
    dateFormat: "DD_MM_YYYY",
    timeFormat: "H24",
    weekStartsOn: 1,
    timeZone: "UTC",
  };
  const mmddyyyy: ResolvedFormatPrefs = {
    ...ddmmyyyy,
    dateFormat: "MM_DD_YYYY",
  };

  it("renders day-month-year order for DD_MM_YYYY prefs", () => {
    // components appear in order regardless of the separator the formatter uses
    expect(formatDateBasedOnLocaleOnly("2026-04-03", ddmmyyyy)).toMatch(
      /^0?3\D+0?4\D+2026$/
    );
  });

  it("renders month-day-year order for MM_DD_YYYY prefs", () => {
    expect(formatDateBasedOnLocaleOnly("2026-04-03", mmddyyyy)).toMatch(
      /^0?4\D+0?3\D+2026$/
    );
  });
});

/**
 * The persistence detector must only stamp a timezone the request can VOUCH for:
 * a present + valid IANA zone. An absent OR malformed cookie maps to the "UTC"
 * fallback in detection, and persisting that would stick the user in UTC forever
 * (indistinguishable from a real UTC, blocking the lazy backfill). Non-timezone
 * fields come from accept-language, so we fix the locale and assert only timeZone.
 */
describe("detectFormatPrefsForPersistence — timezone persistence gate", () => {
  const requestWith = (timeZoneCookie?: string) =>
    new Request("http://localhost/", {
      headers: {
        "accept-language": "en-US",
        ...(timeZoneCookie !== undefined
          ? { cookie: `CH-time-zone=${encodeURIComponent(timeZoneCookie)}` }
          : {}),
      },
    });

  it("returns timeZone null when the CH-time-zone cookie is ABSENT", () => {
    expect(detectFormatPrefsForPersistence(requestWith()).timeZone).toBeNull();
  });

  it("returns timeZone null when the cookie is present but an INVALID zone", () => {
    expect(
      detectFormatPrefsForPersistence(requestWith("Not/AZone")).timeZone
    ).toBeNull();
  });

  it("retains a valid UTC cookie", () => {
    expect(detectFormatPrefsForPersistence(requestWith("UTC")).timeZone).toBe(
      "UTC"
    );
  });

  it("retains a valid non-UTC IANA cookie", () => {
    expect(
      detectFormatPrefsForPersistence(requestWith("America/New_York")).timeZone
    ).toBe("America/New_York");
  });
});

/**
 * The inline `<head>` script runs before any stylesheet has loaded. It is
 * executed here against a minimal fake `document` / `window` / `navigator`,
 * which is all it touches.
 */
describe("CLIENT_HINT_CHECK_SCRIPT", () => {
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function runScript(cookie: string) {
    const writtenCookies: string[] = [];
    const fakeDocument = {
      documentElement: { style: { visibility: "" } },
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        writtenCookies.push(value);
      },
    };
    // why: the node test env has no window, and a real reload would navigate
    // away; the spy records whether the script asks for a reload.
    const reload = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("document", "window", "navigator", CLIENT_HINT_CHECK_SCRIPT)(
      fakeDocument,
      { location: { reload } },
      { cookieEnabled: true }
    );
    return {
      writtenCookies,
      reload,
      style: fakeDocument.documentElement.style,
    };
  }

  it("writes a persistent cookie, hides the page and reloads when the cookie is missing", () => {
    const { writtenCookies, reload, style } = runScript("");

    expect(writtenCookies).toHaveLength(1);
    expect(writtenCookies[0]).toContain(
      `CH-time-zone=${encodeURIComponent(browserTimeZone)}`
    );
    // A session cookie is gone after a browser restart, which would reload
    // the first tab of every session.
    expect(writtenCookies[0]).toMatch(/;max-age=\d+/);
    // Without this, Firefox paints the page it is leaving before its CSS loads.
    expect(style.visibility).toBe("hidden");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("leaves the page alone when the cookie already matches", () => {
    const { writtenCookies, reload, style } = runScript(
      `CH-time-zone=${encodeURIComponent(browserTimeZone)}`
    );

    expect(writtenCookies).toHaveLength(0);
    expect(style.visibility).toBe("");
    expect(reload).not.toHaveBeenCalled();
  });
});
